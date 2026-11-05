// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @notice Test USDC with an open faucet (testnets and local only).
contract MockUSDC is ERC20 {
    function name() public pure override returns (string memory) {
        return "USD Coin (Clutch test)";
    }

    function symbol() public pure override returns (string memory) {
        return "USDC";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Marker token that gives each stream its own USDC/<stream> pool key. Never transferred by swaps.
contract StreamToken is ERC20 {
    string internal _name;
    string internal _symbol;

    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
