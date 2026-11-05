// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Chainlink L2 Sequencer Uptime Feed shape. `answer` is 0 when up and 1 when down; `startedAt` is the
/// L1 timestamp at which the current status began.
interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title SequencerGuard
/// @notice Chain-level sequencer state shared by every hook that cares about it.
///
/// One instance per chain. Any hook (or anyone) calls `observe()`; the first observation of a new UP status anchors
/// a recovery window to the current L2 block number. Anchoring to blocks rather than timestamps matters on OP Stack
/// chains: blocks produced while the sequencer catches up can carry timestamps from the past, so
/// `block.timestamp` math is unreliable exactly when it is needed.
///
/// Consumers:
///  - BlackoutGuardHook prices the recovery window as a descending fee auction.
///  - ClutchHook refuses trades outside Phase.Normal and voids markets whose trading period overlapped an outage.
contract SequencerGuard {
    enum Phase {
        Normal,
        Down,
        Recovering,
        Unknown
    }

    struct State {
        uint64 lastStatusChange; // feed `startedAt` of the last status we saw
        uint64 recoveryBlock; // L2 block at which the latest recovery was first observed
        uint64 outageStart; // L1 time the latest outage began (0 with outageEnd != 0 means "start unknown")
        uint64 outageEnd; // L1 time the latest outage ended (0 while ongoing or if none seen)
        bool lastSeenDown;
        bool seenOutage;
    }

    ISequencerUptimeFeed public immutable feed;
    /// @notice Length of the recovery window in L2 blocks.
    uint32 public immutable recoveryBlocks;
    /// @notice On the very first observation, a status flip this recent still counts as a recovery.
    uint32 public immutable bootGraceSeconds;

    State internal _state;

    event Observed(Phase phase, uint64 statusChangedAt);
    event RecoveryAnchored(uint64 recoveryBlock, uint64 outageStart, uint64 outageEnd);

    constructor(ISequencerUptimeFeed _feed, uint32 _recoveryBlocks, uint32 _bootGraceSeconds) {
        feed = _feed;
        recoveryBlocks = _recoveryBlocks;
        bootGraceSeconds = _bootGraceSeconds;
    }

    /// @notice Read the feed, record any status change, and return the current phase.
    /// @return phase The current phase.
    /// @return blocksIntoRecovery Blocks elapsed since the recovery anchor (only meaningful while Recovering).
    function observe() public returns (Phase phase, uint256 blocksIntoRecovery) {
        (bool ok, bool down, uint64 startedAt) = _read();
        if (!ok) return (Phase.Unknown, 0);

        State memory s = _state;
        if (startedAt != s.lastStatusChange) {
            bool anchored;
            (s, anchored) = _transition(s, down, startedAt);
            _state = s;
            if (anchored) emit RecoveryAnchored(s.recoveryBlock, s.outageStart, s.outageEnd);
            emit Observed(down ? Phase.Down : Phase.Normal, startedAt);
        }
        return _phase(s, down);
    }

    /// @notice View of the phase as `observe()` would report it right now.
    function peek() public view returns (Phase phase, uint256 blocksIntoRecovery) {
        (bool ok, bool down, uint64 startedAt) = _read();
        if (!ok) return (Phase.Unknown, 0);
        State memory s = _state;
        if (startedAt != s.lastStatusChange) (s,) = _transition(s, down, startedAt);
        return _phase(s, down);
    }

    /// @notice True if the most recent known outage overlaps [from, to] (inclusive, L1 time), or one is ongoing,
    /// or the feed is unreadable.
    /// @dev A missed DOWN (we only ever saw the later UP) records the previous status change as its start, which
    /// overlaps everything since then. That is the conservative answer for market integrity.
    function outageOverlaps(uint64 from, uint64 to) external view returns (bool) {
        (bool ok, bool down, uint64 startedAt) = _read();
        if (!ok || down) return true;
        State memory s = _state;
        if (startedAt != s.lastStatusChange) (s,) = _transition(s, down, startedAt);
        if (!s.seenOutage) return false;
        return s.outageStart <= to && (s.outageEnd == 0 || s.outageEnd >= from);
    }

    function state() external view returns (State memory) {
        return _state;
    }

    function _transition(State memory s, bool down, uint64 startedAt)
        internal
        view
        returns (State memory, bool recoveryAnchored)
    {
        bool first = s.lastStatusChange == 0;
        if (down) {
            s.outageStart = startedAt;
            s.outageEnd = 0;
            s.seenOutage = true;
        } else if (!first || block.timestamp <= uint256(startedAt) + bootGraceSeconds) {
            // A new UP. If we never saw the DOWN, its start is unknown: use the previous status change.
            if (!s.lastSeenDown) s.outageStart = s.lastStatusChange;
            s.outageEnd = startedAt;
            s.seenOutage = true;
            s.recoveryBlock = uint64(block.number);
            recoveryAnchored = true;
        }
        s.lastStatusChange = startedAt;
        s.lastSeenDown = down;
        return (s, recoveryAnchored);
    }

    function _phase(State memory s, bool down) internal view returns (Phase, uint256) {
        if (down) return (Phase.Down, 0);
        if (s.recoveryBlock != 0 && block.number < uint256(s.recoveryBlock) + recoveryBlocks) {
            return (Phase.Recovering, block.number - s.recoveryBlock);
        }
        return (Phase.Normal, 0);
    }

    /// @dev Defensive read: a reverting feed, an out-of-range answer, or a zero `startedAt` (an invalid round per
    /// Chainlink) all report `ok = false`, which consumers treat as Unknown.
    function _read() internal view returns (bool ok, bool down, uint64 startedAt) {
        try feed.latestRoundData() returns (uint80, int256 answer, uint256 _startedAt, uint256, uint80) {
            if (_startedAt == 0 || _startedAt > type(uint64).max) return (false, false, 0);
            if (answer != 0 && answer != 1) return (false, false, 0);
            return (true, answer == 1, uint64(_startedAt));
        } catch {
            return (false, false, 0);
        }
    }
}
