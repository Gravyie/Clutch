// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseOverrideFee} from "@openzeppelin/uniswap-hooks/fee/BaseOverrideFee.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SequencerGuard} from "./SequencerGuard.sol";

/// @title BlackoutGuardHook
/// @notice Sequencer-aware dynamic fee for Uniswap v4 pools on L2s.
///
///  - Normal:     `baseFee` (e.g. 0.30%).
///  - Down:       `downFee` ceiling (e.g. 25%). Swaps are priced, never reverted.
///  - Recovering: a Dutch auction from `auctionStartFee` down to `baseFee`, linear over the guard's
///                `recoveryBlocks`, anchored to the L2 block at which recovery was first observed.
///  - Unknown:    the feed is unreadable; charge the ceiling (fail closed for LPs).
///
/// If arbitrageurs compete for the first profitable swap, the stale-price arbitrage is captured as LP fees at the
/// highest fee the jump can bear. If they don't compete, they wait and the fee decays to base, which is no worse than
/// a static pool. `sim/` measures both cases.
contract BlackoutGuardHook is BaseOverrideFee {
    SequencerGuard public immutable guard;
    uint24 public immutable baseFee;
    uint24 public immutable auctionStartFee;
    uint24 public immutable downFee;

    error InvalidFeeSchedule();

    constructor(IPoolManager _poolManager, SequencerGuard _guard, uint24 _baseFee, uint24 _auctionStartFee, uint24 _downFee)
        BaseHook(_poolManager)
    {
        if (!(_baseFee <= _auctionStartFee && _auctionStartFee <= _downFee && _downFee <= LPFeeLibrary.MAX_LP_FEE)) {
            revert InvalidFeeSchedule();
        }
        guard = _guard;
        baseFee = _baseFee;
        auctionStartFee = _auctionStartFee;
        downFee = _downFee;
    }

    /// @notice The fee a swap would pay right now (hundredths of a bip).
    function currentFee() external view returns (uint24) {
        (SequencerGuard.Phase phase, uint256 k) = guard.peek();
        return feeFor(phase, k);
    }

    function feeFor(SequencerGuard.Phase phase, uint256 blocksIntoRecovery) public view returns (uint24) {
        if (phase == SequencerGuard.Phase.Normal) return baseFee;
        if (phase == SequencerGuard.Phase.Recovering) {
            uint256 n = guard.recoveryBlocks();
            if (blocksIntoRecovery >= n) return baseFee;
            uint256 spread = uint256(auctionStartFee - baseFee);
            return uint24(uint256(auctionStartFee) - (spread * blocksIntoRecovery) / n);
        }
        return downFee; // Down or Unknown
    }

    function _getFee(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (uint24)
    {
        (SequencerGuard.Phase phase, uint256 k) = guard.observe();
        return feeFor(phase, k);
    }
}
