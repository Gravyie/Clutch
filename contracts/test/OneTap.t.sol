// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {ClutchBase} from "./Base.t.sol";
import {ClutchHook} from "../src/clutch/ClutchHook.sol";
import {ClutchRouter} from "../src/clutch/ClutchRouter.sol";
import {HumanPassGate} from "../src/clutch/HumanPassGate.sol";
import {SequencerGuard} from "../src/blackout/SequencerGuard.sol";

/// Both hooks in one transaction: ETH → USDC through the Blackout Guard pool, USDC → shares through ClutchHook.
contract OneTapTest is ClutchBase {
    uint160 constant BLACKOUT_FLAGS = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
    uint160 constant SQRT_PRICE_2000 = 3543191142285914205922034; // ETH at 2,000 USDC

    PoolKey ethKey;
    address carol = makeAddr("carol"); // holds only ETH: no USDC, no approvals
    uint256 constant CAROL_NULLIFIER = 3;

    function setUp() public override {
        super.setUp();
        address bh = address(uint160(BLACKOUT_FLAGS) | (uint160(0xB1) << 144));
        deployCodeTo("BlackoutGuardHook.sol:BlackoutGuardHook", abi.encode(manager, guard, uint24(3_000), uint24(150_000), uint24(250_000)), bh);
        ethKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(usdc)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(bh));
        manager.initialize(ethKey, SQRT_PRICE_2000);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(lpRouter), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        lpRouter.modifyLiquidity{value: 5_000 ether}(ethKey, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e17, salt: 0}), "");
        vm.deal(carol, 1 ether);
    }

    receive() external payable {} // the LP router refunds unused ETH

    function _betEth(address who, uint256 nullifier, uint256 id, bool yes, uint256 eth) internal returns (uint256 usdcIn, uint256 shares) {
        bytes memory pass = _pass(who, nullifier);
        vm.prank(who);
        return router.backWithEth{value: eth}(ethKey, key, id, yes, 0, 0, pass);
    }

    function test_betWithEth_inOneTransaction_noUsdcNoApproval() public {
        uint256 id = _open(0.5e18, 100e6);
        uint256 pmUsdcBefore = usdc.balanceOf(address(manager));

        (uint256 usdcIn, uint256 shares) = _betEth(carol, CAROL_NULLIFIER, id, true, 0.005 ether);

        assertApproxEqRel(usdcIn, 10e6, 0.01e18, "0.005 ETH at 2,000 = ~10 USDC after the 0.3% fee");
        assertGt(shares, usdcIn, "YES at ~50c buys more than one share per dollar");
        assertEq(usdc.balanceOf(carol), 0, "carol never held USDC");
        assertEq(carol.balance, 1 ether - 0.005 ether, "exactly the ETH sent was spent");
        // The USDC from the swap went straight into the market inside the PoolManager (as the hook's ERC-6909 claim).
        assertEq(usdc.balanceOf(address(manager)), pmUsdcBefore, "no USDC entered or left the PoolManager");
        (uint128 yesShares,,,) = hook.positions(id, carol);
        assertEq(yesShares, shares);

        vm.warp(block.timestamp + 20 + BUFFER);
        vm.prank(resolver);
        hook.resolve(id, ClutchHook.Outcome.Yes, keccak256("evidence"));
        hook.claim(id, carol);
        assertEq(usdc.balanceOf(carol), shares, "winner is paid in USDC");
    }

    function test_betWithEth_countsTowardTheHumansDailyCap() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory pass = _passWithCap(carol, CAROL_NULLIFIER, 5e6); // $5 a day
        vm.prank(carol);
        vm.expectRevert(); // ~$10 of ETH is over the cap, measured in USDC after the swap
        router.backWithEth{value: 0.005 ether}(ethKey, key, id, true, 0, 0, pass);
    }

    function test_betWithEth_streamerStillBlocked() public {
        uint256 id = _open(0.5e18, 100e6);
        vm.deal(streamerWallet, 1 ether);
        bytes memory pass = _pass(streamerWallet, STREAMER_NULLIFIER);
        vm.prank(streamerWallet);
        vm.expectRevert();
        router.backWithEth{value: 0.005 ether}(ethKey, key, id, true, 0, 0, pass);
    }

    function test_betWithEth_refusedDuringOutage_andOnrampChargesTheCeiling() public {
        uint256 id = _open(0.5e18, 100e6);
        feed.setStatus(true, block.timestamp); // sequencer down
        bytes memory pass = _pass(carol, CAROL_NULLIFIER);
        vm.prank(carol);
        vm.expectRevert(); // the market refuses; the whole transaction, including the ETH swap, reverts
        router.backWithEth{value: 0.005 ether}(ethKey, key, id, true, 0, 0, pass);
        assertEq(carol.balance, 1 ether, "nothing was spent");
    }

    function test_betWithEth_slippageOnTheOnramp() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory pass = _pass(carol, CAROL_NULLIFIER);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ClutchRouter.InsufficientOutput.selector, 9_969_977, 11e6));
        router.backWithEth{value: 0.005 ether}(ethKey, key, id, true, 11e6, 0, pass);
    }

    function test_betWithEth_rejectsNonEthPool() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory pass = _pass(carol, CAROL_NULLIFIER);
        vm.prank(carol);
        vm.expectRevert(ClutchRouter.NotAnEthPool.selector);
        router.backWithEth{value: 0.005 ether}(key, key, id, true, 0, 0, pass);
    }

    // ── Signed bets, delivered by someone else (a Relay solver bridging from another chain) ──

    uint256 constant CAROL_PK = 0xCA401;
    address solver = makeAddr("relaySolver");

    function _signBet(uint256 pk, ClutchRouter.Bet memory b) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(router.BET_TYPEHASH(), b.trader, b.marketId, b.yes, b.minShares, b.deadline, b.nonce));
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = router.eip712Domain();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _bet(address trader, uint256 id, uint256 nonce) internal view returns (ClutchRouter.Bet memory) {
        return ClutchRouter.Bet(trader, id, true, 0, uint64(block.timestamp + 60), nonce);
    }

    function test_signedBet_deliveredBySolver_creditsTheSigner() public {
        address trader = vm.addr(CAROL_PK);
        uint256 id = _open(0.5e18, 100e6);
        ClutchRouter.Bet memory b = _bet(trader, id, 1);
        bytes memory sig = _signBet(CAROL_PK, b);
        vm.deal(solver, 1 ether);
        vm.prank(solver);
        uint256 shares = router.backWithEthFor{value: 0.005 ether}(ethKey, key, b, sig, 0, _pass(trader, CAROL_NULLIFIER));
        assertGt(shares, 0);
        (uint128 yesShares,,,) = hook.positions(id, trader);
        assertEq(yesShares, shares, "the position belongs to the signer");
        (uint128 solverShares,,,) = hook.positions(id, solver);
        assertEq(solverShares, 0, "the solver gets nothing");
        assertTrue(router.nonceUsed(trader, 1));
    }

    function test_signedBet_marketLocked_refundsTheTrader() public {
        address trader = vm.addr(CAROL_PK);
        uint256 id = _open(0.5e18, 100e6);
        vm.warp(block.timestamp + 21); // the bridge landed after lock
        ClutchRouter.Bet memory b = _bet(trader, id, 2);
        bytes memory sig = _signBet(CAROL_PK, b);
        vm.deal(solver, 1 ether);
        vm.prank(solver);
        uint256 shares = router.backWithEthFor{value: 0.005 ether}(ethKey, key, b, sig, 0, _pass(trader, CAROL_NULLIFIER));
        assertEq(shares, 0);
        assertEq(trader.balance, 0.005 ether, "the ETH lands in the trader's wallet, not lost in the bridge");
    }

    function test_signedBet_rejectsForgedSignatureAndReplay() public {
        address trader = vm.addr(CAROL_PK);
        uint256 id = _open(0.5e18, 100e6);
        ClutchRouter.Bet memory b = _bet(trader, id, 3);
        bytes memory forged = _signBet(0xBAD, b);
        bytes memory pass = _pass(trader, CAROL_NULLIFIER);
        vm.deal(solver, 1 ether);
        vm.prank(solver);
        vm.expectRevert(ClutchRouter.BadBetSignature.selector);
        router.backWithEthFor{value: 0.001 ether}(ethKey, key, b, forged, 0, pass);

        bytes memory sig = _signBet(CAROL_PK, b);
        vm.prank(solver);
        router.backWithEthFor{value: 0.001 ether}(ethKey, key, b, sig, 0, pass);
        vm.prank(solver);
        vm.expectRevert(ClutchRouter.NonceUsed.selector);
        router.backWithEthFor{value: 0.001 ether}(ethKey, key, b, sig, 0, pass);
    }

    function test_signedBet_expires() public {
        address trader = vm.addr(CAROL_PK);
        uint256 id = _open(0.5e18, 100e6);
        ClutchRouter.Bet memory b = _bet(trader, id, 4);
        bytes memory sig = _signBet(CAROL_PK, b);
        vm.warp(block.timestamp + 61);
        bytes memory pass = _pass(trader, CAROL_NULLIFIER);
        vm.deal(solver, 1 ether);
        vm.prank(solver);
        vm.expectRevert(ClutchRouter.BetExpired.selector);
        router.backWithEthFor{value: 0.001 ether}(ethKey, key, b, sig, 0, pass);
    }
}
