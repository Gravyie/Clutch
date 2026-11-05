// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISequencerUptimeFeed} from "./SequencerGuard.sol";

/// @notice Controllable stand-in for the Chainlink L2 Sequencer Uptime Feed, for testnet demos and tests.
contract MockSequencerFeed is ISequencerUptimeFeed {
    address public immutable operator;
    uint80 public round;
    int256 public answer;
    uint256 public startedAt;
    bool public broken;

    error NotOperator();

    constructor() {
        operator = msg.sender;
        round = 1;
        startedAt = block.timestamp > 1 days ? block.timestamp - 1 days : 1;
    }

    /// @param down true for DOWN (answer 1), false for UP (answer 0).
    /// @param at L1 timestamp at which the status began.
    function setStatus(bool down, uint256 at) external {
        if (msg.sender != operator) revert NotOperator();
        round++;
        answer = down ? int256(1) : int256(0);
        startedAt = at;
    }

    function setBroken(bool b) external {
        if (msg.sender != operator) revert NotOperator();
        broken = b;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed: broken");
        return (round, answer, startedAt, startedAt, round);
    }
}
