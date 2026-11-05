// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626} from "solady/tokens/ERC4626.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ISubsidyVault} from "../interfaces/IClutch.sol";

/// @title LPVault
/// @notice One USDC vault that funds the worst-case subsidy of every Clutch market.
///
/// When a market opens, the hook draws its exact worst-case loss (b·ln(1/min(p, 1−p))) from here. When it settles,
/// the hook returns whatever is left of the pot plus the LP share of fees. LPs therefore never lose more than the
/// sum of open subsidies, which `outstanding` reports live, and the owner caps it as a fraction of the vault.
contract LPVault is ERC4626, ISubsidyVault {
    using SafeTransferLib for address;

    address internal immutable _asset;
    address public owner;
    address public hook;

    /// @notice Subsidies currently out in open markets (marked at cost).
    uint256 public outstanding;
    /// @notice Max share of total assets at risk across all open markets, in bps.
    uint16 public maxExposureBps = 2_000;
    /// @notice Max share of total assets for one market's subsidy, in bps.
    uint16 public maxPerMarketBps = 500;

    int256 public realizedPnl;
    uint256 public marketsFunded;

    event Funded(uint256 amount, uint256 outstanding);
    event Settled(uint256 principal, uint256 returned, int256 pnl);

    error NotOwner();
    error NotHook();
    error ExposureCapExceeded(uint256 wouldBe, uint256 cap);
    error PerMarketCapExceeded(uint256 amount, uint256 cap);

    constructor(address asset_) {
        _asset = asset_;
        owner = msg.sender;
    }

    function asset() public view override returns (address) {
        return _asset;
    }

    function name() public pure override returns (string memory) {
        return "Clutch LP Vault";
    }

    function symbol() public pure override returns (string memory) {
        return "clLP";
    }

    function setHook(address _hook) external {
        if (msg.sender != owner) revert NotOwner();
        hook = _hook;
    }

    function setCaps(uint16 exposureBps, uint16 perMarketBps) external {
        if (msg.sender != owner) revert NotOwner();
        maxExposureBps = exposureBps;
        maxPerMarketBps = perMarketBps;
    }

    function totalAssets() public view override returns (uint256) {
        return idle() + outstanding;
    }

    function idle() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    /// @notice LPs can only withdraw what is not currently backing a market.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 m = super.maxWithdraw(owner_);
        uint256 i = idle();
        return m < i ? m : i;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 m = super.maxRedeem(owner_);
        uint256 i = convertToShares(idle());
        return m < i ? m : i;
    }

    /// @inheritdoc ISubsidyVault
    function fund(uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        uint256 total = totalAssets();
        uint256 perMarketCap = total * maxPerMarketBps / 10_000;
        if (amount > perMarketCap) revert PerMarketCapExceeded(amount, perMarketCap);
        uint256 cap = total * maxExposureBps / 10_000;
        if (outstanding + amount > cap) revert ExposureCapExceeded(outstanding + amount, cap);
        outstanding += amount;
        marketsFunded++;
        _asset.safeTransfer(hook, amount);
        emit Funded(amount, outstanding);
    }

    /// @inheritdoc ISubsidyVault
    function settle(uint256 principal, uint256 returned) external {
        if (msg.sender != hook) revert NotHook();
        outstanding -= principal;
        int256 pnl = int256(returned) - int256(principal);
        realizedPnl += pnl;
        emit Settled(principal, returned, pnl);
    }
}
