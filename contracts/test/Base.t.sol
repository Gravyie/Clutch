// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {ClutchHook} from "../src/clutch/ClutchHook.sol";
import {ClutchRouter} from "../src/clutch/ClutchRouter.sol";
import {HumanPassGate} from "../src/clutch/HumanPassGate.sol";
import {LPVault} from "../src/clutch/LPVault.sol";
import {SequencerGuard, ISequencerUptimeFeed} from "../src/blackout/SequencerGuard.sol";
import {MockSequencerFeed} from "../src/blackout/MockSequencerFeed.sol";
import {MockUSDC, StreamToken} from "../src/mocks/Tokens.sol";

abstract contract ClutchBase is Test {
    using PoolIdLibrary for PoolKey;

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 constant CLUTCH_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;

    PoolManager manager;
    MockUSDC usdc;
    MockSequencerFeed feed;
    SequencerGuard guard;
    HumanPassGate gate;
    LPVault vault;
    ClutchHook hook;
    ClutchRouter router;
    PoolKey key;
    PoolId pid;

    uint256 signerPk = 0xA11CE;
    address signer;
    address engine = makeAddr("engine");
    address resolver = makeAddr("resolver");
    address treasury = makeAddr("treasury");
    address streamer = makeAddr("streamer");
    address lp = makeAddr("lp");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address streamerWallet = makeAddr("streamerWallet");

    uint256 constant STREAMER_NULLIFIER = 777;
    uint256 constant ALICE_NULLIFIER = 1;
    uint256 constant BOB_NULLIFIER = 2;
    uint32 constant BUFFER = 15;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.roll(1_000);
        signer = vm.addr(signerPk);
        manager = new PoolManager(address(this));
        usdc = new MockUSDC();
        feed = new MockSequencerFeed();
        guard = new SequencerGuard(ISequencerUptimeFeed(address(feed)), 40, 1 hours);
        gate = new HumanPassGate(signer, 500e6);
        vault = new LPVault(address(usdc));
        router = new ClutchRouter(manager);

        address hookAddr = address(uint160(CLUTCH_FLAGS) | (uint160(0xC1) << 144));
        deployCodeTo("ClutchHook.sol:ClutchHook", abi.encode(manager, address(usdc), guard, address(this)), hookAddr);
        hook = ClutchHook(hookAddr);
        hook.configure(engine, resolver, treasury, gate, vault);
        hook.setTrustedRouter(address(router), true);
        gate.setHook(address(hook));
        vault.setHook(address(hook));

        StreamToken st = new StreamToken("Clutch Stream: lichess-tv", "cTV");
        (Currency c0, Currency c1) = address(usdc) < address(st)
            ? (Currency.wrap(address(usdc)), Currency.wrap(address(st)))
            : (Currency.wrap(address(st)), Currency.wrap(address(usdc)));
        key = PoolKey(c0, c1, 0, 60, IHooks(hookAddr));
        manager.initialize(key, SQRT_PRICE_1_1);
        hook.registerStream(key, streamer, STREAMER_NULLIFIER, BUFFER);
        pid = key.toId();

        usdc.mint(lp, 100_000e6);
        vm.startPrank(lp);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, lp);
        vm.stopPrank();

        _fund(alice);
        _fund(bob);
        _fund(streamerWallet);
    }

    function _fund(address who) internal {
        usdc.mint(who, 1_000e6);
        vm.prank(who);
        usdc.approve(address(router), type(uint256).max);
    }

    function _pass(address trader, uint256 nullifier) internal view returns (bytes memory) {
        return _passWithCap(trader, nullifier, 200e6);
    }

    function _passWithCap(address trader, uint256 nullifier, uint128 cap) internal view returns (bytes memory) {
        HumanPassGate.HumanPass memory p = HumanPassGate.HumanPass(trader, nullifier, uint64(block.timestamp + 1 hours), cap);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, gate.hashPass(p));
        return abi.encode(p, abi.encodePacked(r, s, v));
    }

    function _open(uint64 pYes, uint128 b) internal returns (uint256 id) {
        uint64 lock = uint64(block.timestamp + 20);
        vm.prank(engine);
        id = hook.openMarket(pid, keccak256("rule"), lock, lock + BUFFER, lock + BUFFER + 60, b, pYes);
    }

    function _back(address who, uint256 nullifier, uint256 id, bool yes, uint128 amount) internal returns (uint256) {
        bytes memory pass = _pass(who, nullifier);
        vm.prank(who);
        return router.back(key, id, yes, amount, 0, pass);
    }
}
