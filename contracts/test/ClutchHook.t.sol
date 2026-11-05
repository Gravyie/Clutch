// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ClutchBase} from "./Base.t.sol";
import {ClutchHook} from "../src/clutch/ClutchHook.sol";
import {HumanPassGate} from "../src/clutch/HumanPassGate.sol";
import {SequencerGuard} from "../src/blackout/SequencerGuard.sol";

contract ClutchHookTest is ClutchBase {
    function test_fullLifecycle_yesWins() public {
        uint256 id = _open(0.5e18, 100e6);
        ClutchHook.Market memory m = hook.market(id);
        // b·ln2 for a 50/50 open, rounded up.
        assertEq(m.subsidy, 69_314_719);
        assertEq(vault.outstanding(), m.subsidy);

        uint256 aShares = _back(alice, ALICE_NULLIFIER, id, true, 10e6);
        uint256 bShares = _back(bob, BOB_NULLIFIER, id, false, 20e6);
        assertGt(aShares, 10e6, "YES at ~50c buys more than 1 share per dollar");
        assertGt(bShares, 20e6);
        assertLt(hook.priceYes(id), 0.5e18, "NO buying pushes YES down");

        vm.warp(block.timestamp + 20 + BUFFER);
        vm.prank(resolver);
        hook.resolve(id, ClutchHook.Outcome.Yes, keccak256("evidence"));

        uint256 before = usdc.balanceOf(alice);
        hook.claim(id, alice);
        assertEq(usdc.balanceOf(alice) - before, aShares);

        vm.expectRevert(ClutchHook.NothingToClaim.selector);
        hook.claim(id, bob);

        // Fees: 2% of 30 USDC = 0.6 USDC → streamer 0.15, resolver 0.075, treasury 0.075, LPs 0.3.
        assertEq(hook.owed(streamer), 150_000);
        assertEq(hook.owed(resolver), 75_000);
        assertEq(hook.owed(treasury), 75_000);
        assertEq(vault.outstanding(), 0);
    }

    function test_forwardOnlyWindow_isEnforcedOnchain() public {
        uint64 lock = uint64(block.timestamp + 20);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(ClutchHook.WindowNotForward.selector, lock + BUFFER - 1, lock + BUFFER));
        hook.openMarket(pid, keccak256("rule"), lock, lock + BUFFER - 1, lock + 100, 100e6, 0.5e18);
    }

    function test_uncertaintyBand() public {
        uint64 lock = uint64(block.timestamp + 20);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(ClutchHook.NotUncertain.selector, uint64(0.9e18)));
        hook.openMarket(pid, keccak256("rule"), lock, lock + BUFFER, lock + 100, 100e6, 0.9e18);
    }

    function test_oneLiveMarketPerStream() public {
        uint256 id = _open(0.5e18, 100e6);
        uint64 lock = uint64(block.timestamp + 20);
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(ClutchHook.MarketStillLive.selector, id));
        hook.openMarket(pid, keccak256("rule2"), lock, lock + BUFFER, lock + 100, 100e6, 0.5e18);
    }

    function test_subsidyMatchesSkewedOpen() public {
        uint256 id = _open(0.2e18, 100e6);
        // b·ln(1/0.2) = 100·1.6094 = 160.94 USDC
        assertApproxEqAbs(hook.market(id).subsidy, 160_943_792, 2);
        assertApproxEqAbs(hook.priceYes(id), 0.2e18, 1e6);
    }

    function test_tradeAfterLock_reverts() public {
        uint256 id = _open(0.5e18, 100e6);
        vm.warp(block.timestamp + 20);
        bytes memory pass = _pass(alice, ALICE_NULLIFIER);
        vm.prank(alice);
        vm.expectRevert();
        router.back(key, id, true, 10e6, 0, pass);
    }

    function test_streamerCannotTradeOwnMarket() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory pass = _pass(streamerWallet, STREAMER_NULLIFIER);
        vm.expectRevert(HumanPassGate.StreamerCannotTradeOwnMarket.selector);
        gate.preflight(streamerWallet, 10e6, STREAMER_NULLIFIER, pass);
        vm.prank(streamerWallet);
        vm.expectRevert();
        router.back(key, id, true, 10e6, 0, pass);
    }

    function test_selfExclusion_followsThePersonAcrossWallets() public {
        uint256 id = _open(0.5e18, 100e6);
        (HumanPassGate.HumanPass memory p, bytes memory sig) =
            abi.decode(_pass(alice, ALICE_NULLIFIER), (HumanPassGate.HumanPass, bytes));
        vm.prank(alice);
        gate.selfExclude(p, sig, 30 days);

        // Same human, brand-new wallet: still excluded.
        address fresh = makeAddr("alice2");
        _fund(fresh);
        bytes memory pass2 = _pass(fresh, ALICE_NULLIFIER);
        vm.expectRevert(abi.encodeWithSelector(HumanPassGate.SelfExcludedUntil.selector, uint64(block.timestamp + 30 days)));
        gate.preflight(fresh, 1e6, STREAMER_NULLIFIER, pass2);
        vm.prank(fresh);
        vm.expectRevert();
        router.back(key, id, true, 1e6, 0, pass2);
    }

    function test_dailyCap_isPerHuman() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory pass = _passWithCap(alice, ALICE_NULLIFIER, 25e6);
        vm.prank(alice);
        router.back(key, id, true, 20e6, 0, pass);

        address fresh = makeAddr("alice2");
        _fund(fresh);
        bytes memory pass2 = _passWithCap(fresh, ALICE_NULLIFIER, 25e6);
        vm.expectRevert(abi.encodeWithSelector(HumanPassGate.DailyCapExceeded.selector, 20e6, 25e6));
        gate.preflight(fresh, 10e6, STREAMER_NULLIFIER, pass2);
    }

    function test_passBoundToWallet() public {
        uint256 id = _open(0.5e18, 100e6);
        bytes memory alicesPass = _pass(alice, ALICE_NULLIFIER);
        vm.prank(bob);
        vm.expectRevert();
        router.back(key, id, true, 1e6, 0, alicesPass);
    }

    function test_void_refundsAtCostIncludingFees() public {
        uint256 id = _open(0.5e18, 100e6);
        _back(alice, ALICE_NULLIFIER, id, true, 10e6);
        _back(bob, BOB_NULLIFIER, id, false, 30e6);
        uint256 vaultBefore = vault.totalAssets();

        vm.prank(resolver);
        hook.resolve(id, ClutchHook.Outcome.Void, keccak256("sources disagreed"));

        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        hook.claim(id, alice);
        hook.claim(id, bob);
        assertEq(usdc.balanceOf(alice) - a0, 10e6);
        assertEq(usdc.balanceOf(bob) - b0, 30e6);
        assertEq(vault.totalAssets(), vaultBefore, "LPs whole on void");
        assertEq(hook.heldUsdc(), 0);
    }

    function test_cannotResolveBeforeWindow() public {
        uint256 id = _open(0.5e18, 100e6);
        vm.prank(resolver);
        vm.expectRevert(ClutchHook.WindowNotStarted.selector);
        hook.resolve(id, ClutchHook.Outcome.Yes, 0);
    }

    function test_expire_unlocksRefunds() public {
        uint256 id = _open(0.5e18, 100e6);
        _back(alice, ALICE_NULLIFIER, id, true, 10e6);
        vm.expectRevert(ClutchHook.NotExpired.selector);
        hook.expire(id);
        vm.warp(block.timestamp + 20 + BUFFER + 60 + 1 hours + 1);
        hook.expire(id);
        assertEq(hook.claim(id, alice), 10e6);
    }

    function test_streamerPause() public {
        vm.prank(streamer);
        hook.setPaused(pid, true);
        uint64 lock = uint64(block.timestamp + 20);
        vm.prank(engine);
        vm.expectRevert(ClutchHook.StreamIsPaused.selector);
        hook.openMarket(pid, keccak256("rule"), lock, lock + BUFFER, lock + 100, 100e6, 0.5e18);
    }

    // ─── Blackout Guard integration ─────────────────────────────────────────────────────────────

    function test_blackout_noTradingWhileDown() public {
        uint256 id = _open(0.5e18, 100e6);
        feed.setStatus(true, block.timestamp);
        bytes memory pass = _pass(alice, ALICE_NULLIFIER);
        vm.prank(alice);
        vm.expectRevert();
        router.back(key, id, true, 10e6, 0, pass);
    }

    function test_blackout_noTradingDuringRecoveryAuction() public {
        uint256 id = _open(0.5e18, 100e6);
        feed.setStatus(true, block.timestamp - 5);
        guard.observe();
        feed.setStatus(false, block.timestamp - 1);
        guard.observe();
        (SequencerGuard.Phase ph,) = guard.peek();
        assertEq(uint8(ph), uint8(SequencerGuard.Phase.Recovering));
        bytes memory pass = _pass(alice, ALICE_NULLIFIER);
        vm.prank(alice);
        vm.expectRevert();
        router.back(key, id, true, 10e6, 0, pass);
    }

    /// The attack: catch-up blocks after an outage carry old timestamps, so a trade placed after the real lock can
    /// land in a block stamped before it. We can't see that at trade time, but the feed reports the outage later,
    /// and any market whose trading period overlapped it is voided.
    function test_blackout_overlappingOutageVoidsMarket() public {
        uint256 id = _open(0.5e18, 100e6);
        _back(alice, ALICE_NULLIFIER, id, true, 10e6);
        uint64 lock = hook.market(id).lockTime;

        // Outage began 5s before lock and ended after the window started.
        feed.setStatus(true, lock - 5);
        vm.warp(lock + BUFFER + 10);
        feed.setStatus(false, lock + BUFFER + 5);
        guard.observe(); // any swap or keeper anchors the recovery
        vm.roll(block.number + 100); // past the recovery auction

        vm.prank(resolver);
        vm.expectEmit(true, false, false, false, address(hook));
        emit ClutchHook.BlackoutVoid(id);
        hook.resolve(id, ClutchHook.Outcome.Yes, keccak256("e"));
        assertEq(uint8(hook.market(id).outcome), uint8(ClutchHook.Outcome.Void));
        assertEq(hook.claim(id, alice), 10e6);
    }

    function test_blackout_unrelatedOutageDoesNotVoid() public {
        // Outage that ended long before this market opened.
        feed.setStatus(true, block.timestamp - 3 hours);
        feed.setStatus(false, block.timestamp - 2 hours);
        guard.observe();
        uint256 id = _open(0.5e18, 100e6);
        _back(alice, ALICE_NULLIFIER, id, true, 10e6);
        vm.warp(block.timestamp + 20 + BUFFER);
        vm.prank(resolver);
        hook.resolve(id, ClutchHook.Outcome.Yes, keccak256("e"));
        assertEq(uint8(hook.market(id).outcome), uint8(ClutchHook.Outcome.Yes));
    }

    // ─── Solvency ───────────────────────────────────────────────────────────────────────────────

    /// Whatever the trades and whichever outcome, every winner (or every refund) is paid in full and the hook is
    /// left with only the fees it owes.
    function testFuzz_solvency(uint64 pSeed, uint128 bSeed, uint256 tradeSeed, uint8 outcomeSeed) public {
        uint64 p = uint64(bound(pSeed, 0.15e18, 0.85e18));
        uint128 b = uint128(bound(bSeed, 5e6, 2_000e6));
        uint256 id = _open(p, b);

        address[4] memory who = [alice, bob, makeAddr("carol"), makeAddr("dave")];
        _fund(who[2]);
        _fund(who[3]);
        for (uint256 i; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(tradeSeed, i)));
            uint128 amt = uint128(bound(r, 1e6, 15e6));
            _back(who[i % 4], 100 + (i % 4), id, (r >> 128) % 2 == 0, amt);
        }

        vm.warp(block.timestamp + 20 + BUFFER);
        ClutchHook.Outcome o = ClutchHook.Outcome(1 + (outcomeSeed % 3));
        vm.prank(resolver);
        hook.resolve(id, o, keccak256("e"));
        for (uint256 i; i < 4; i++) {
            (uint128 y, uint128 n, uint128 c,) = hook.positions(id, who[i]);
            uint256 due = o == ClutchHook.Outcome.Void ? c : (o == ClutchHook.Outcome.Yes ? y : n);
            if (due > 0) hook.claim(id, who[i]);
        }
        uint256 owedTotal = hook.owed(streamer) + hook.owed(resolver) + hook.owed(treasury);
        assertEq(hook.heldUsdc(), owedTotal, "only fees remain");
        assertEq(vault.outstanding(), 0);
    }
}
