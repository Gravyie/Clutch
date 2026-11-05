// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {BlackoutGuardHook} from "../src/blackout/BlackoutGuardHook.sol";
import {SequencerGuard, ISequencerUptimeFeed} from "../src/blackout/SequencerGuard.sol";
import {MockSequencerFeed} from "../src/blackout/MockSequencerFeed.sol";
import {ClutchRouter} from "../src/clutch/ClutchRouter.sol";
import {MockUSDC} from "../src/mocks/Tokens.sol";

contract BlackoutGuardTest is Test {
    uint160 constant FLAGS = Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
    // sqrt(2000e6 / 1e18) * 2^96: ETH at 2,000 USDC
    uint160 constant SQRT_PRICE_2000 = 3543191142285914205922034;
    uint32 constant RECOVERY_BLOCKS = 40;

    PoolManager manager;
    MockUSDC usdc;
    MockSequencerFeed feed;
    SequencerGuard guard;
    BlackoutGuardHook hook;
    ClutchRouter router;
    PoolKey key;
    address trader = makeAddr("trader");

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(5_000);
        manager = new PoolManager(address(this));
        usdc = new MockUSDC();
        feed = new MockSequencerFeed();
        guard = new SequencerGuard(ISequencerUptimeFeed(address(feed)), RECOVERY_BLOCKS, 1 hours);
        address hookAddr = address(uint160(FLAGS) | (uint160(0xB1) << 144));
        deployCodeTo(
            "BlackoutGuardHook.sol:BlackoutGuardHook",
            abi.encode(manager, guard, uint24(3_000), uint24(150_000), uint24(250_000)),
            hookAddr
        );
        hook = BlackoutGuardHook(hookAddr);
        router = new ClutchRouter(manager);

        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(usdc)), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hookAddr));
        manager.initialize(key, SQRT_PRICE_2000);

        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(lpRouter), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        lpRouter.modifyLiquidity{value: 5_000 ether}(
            key, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e17, salt: 0}), ""
        );
        vm.deal(trader, 100 ether);
    }

    function _swapEth(uint128 amountIn) internal returns (uint256) {
        vm.prank(trader);
        return router.swapExactIn{value: amountIn}(key, true, amountIn, 0, trader);
    }

    function test_normal_chargesBaseFee() public view {
        assertEq(hook.currentFee(), 3_000);
    }

    function test_down_chargesCeilingWithoutReverting() public {
        feed.setStatus(true, block.timestamp);
        assertEq(hook.currentFee(), 250_000);
        uint256 out = _swapEth(1 ether);
        assertGt(out, 0, "swaps still execute while down");
        assertLt(out, 1_600e6, "but pay the 25% ceiling");
    }

    function test_recovery_isABlockAnchoredDutchAuction() public {
        feed.setStatus(true, block.timestamp - 600);
        guard.observe();
        feed.setStatus(false, block.timestamp - 1);
        guard.observe();
        assertEq(hook.currentFee(), 150_000, "auction opens at the start fee");

        vm.roll(block.number + RECOVERY_BLOCKS / 2);
        assertEq(hook.currentFee(), 150_000 - (147_000 * 20) / 40, "halfway through, halfway down");

        // Wall-clock time is irrelevant: warping hours without blocks does not move the fee.
        vm.warp(block.timestamp + 6 hours);
        assertEq(hook.currentFee(), 76_500);

        vm.roll(block.number + RECOVERY_BLOCKS / 2);
        assertEq(hook.currentFee(), 3_000, "back to base after the auction");
    }

    function test_recovery_firstSwapPaysAuctionFee() public {
        uint256 normalOut = _quoteNormal(1 ether);
        feed.setStatus(true, block.timestamp - 600);
        feed.setStatus(false, block.timestamp - 1);
        uint256 out = _swapEth(1 ether);
        assertLt(out, normalOut * 86 / 100, "~15% fee captured by LPs");
    }

    function test_missedDown_stillAnchorsRecovery() public {
        guard.observe(); // sees the initial UP from a day ago: not a recovery
        assertEq(hook.currentFee(), 3_000);
        // DOWN and UP both happened between our observations.
        feed.setStatus(true, block.timestamp + 10);
        feed.setStatus(false, block.timestamp + 70);
        vm.warp(block.timestamp + 80);
        assertEq(hook.currentFee(), 150_000);
        assertTrue(guard.outageOverlaps(uint64(block.timestamp - 100), uint64(block.timestamp - 90)));
    }

    function test_bootGrace() public {
        // A guard deployed long after the last flip does not start an auction.
        assertEq(hook.currentFee(), 3_000);
        // One deployed just after a flip does.
        MockSequencerFeed f2 = new MockSequencerFeed();
        f2.setStatus(false, block.timestamp - 30);
        SequencerGuard g2 = new SequencerGuard(ISequencerUptimeFeed(address(f2)), RECOVERY_BLOCKS, 1 hours);
        (SequencerGuard.Phase ph,) = g2.observe();
        assertEq(uint8(ph), uint8(SequencerGuard.Phase.Recovering));
    }

    function test_brokenFeed_failsClosedForLPs() public {
        feed.setBroken(true);
        assertEq(hook.currentFee(), 250_000);
        (SequencerGuard.Phase ph,) = guard.peek();
        assertEq(uint8(ph), uint8(SequencerGuard.Phase.Unknown));
    }

    function test_invalidRound_isUnknown() public {
        feed.setStatus(false, 0);
        (SequencerGuard.Phase ph,) = guard.peek();
        assertEq(uint8(ph), uint8(SequencerGuard.Phase.Unknown));
    }

    function test_rejectsStaticFeePool() public {
        PoolKey memory k = key;
        k.fee = 3_000;
        vm.expectRevert();
        manager.initialize(k, SQRT_PRICE_2000);
    }

    function testFuzz_feeMonotoneNonIncreasingDuringRecovery(uint8 a, uint8 b) public {
        feed.setStatus(true, block.timestamp - 600);
        feed.setStatus(false, block.timestamp - 1);
        guard.observe();
        uint256 x = bound(a, 0, 80);
        uint256 y = bound(b, x, 80);
        uint24 fx = hook.feeFor(SequencerGuard.Phase.Recovering, x);
        uint24 fy = hook.feeFor(SequencerGuard.Phase.Recovering, y);
        assertLe(fy, fx);
        assertGe(fy, 3_000);
        assertLe(fx, 150_000);
    }

    function _quoteNormal(uint128 amountIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        out = _swapEth(amountIn);
        vm.revertToState(snap);
    }

    receive() external payable {}
}
