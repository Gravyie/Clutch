// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Admission control for a trade. Reverts with a specific error when a trade is refused, so every
/// refusal names the rule that blocked it.
interface IClutchGate {
    /// @return nullifier The person (not the wallet) behind the trade.
    function admit(address trader, uint256 amount, uint256 streamerNullifier, bytes calldata gateData)
        external
        returns (uint256 nullifier);
}

/// @notice The shared vault that funds every market's worst-case subsidy.
interface ISubsidyVault {
    /// @notice Send `amount` to the hook as a market subsidy. Reverts if exposure caps would be exceeded.
    function fund(uint256 amount) external;
    /// @notice Close out a subsidy of `principal`; the hook has already transferred `returned` back.
    function settle(uint256 principal, uint256 returned) external;
}
