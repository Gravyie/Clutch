// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IClutchGate} from "../interfaces/IClutch.sol";

/// @title HumanPassGate
/// @notice Person-level limits for Clutch, keyed to a World ID nullifier rather than a wallet.
///
/// The backend verifies a World ID proof (unique human, and 18+ where the credential supports it), then signs a
/// short-lived HumanPass binding {wallet, nullifier, daily cap}. The hook calls `admit` on every trade. A fresh
/// wallet can't reset a cap or an exclusion, because both live on the nullifier.
contract HumanPassGate is IClutchGate, EIP712 {
    struct HumanPass {
        address trader;
        uint256 nullifier;
        uint64 expiry;
        uint128 dailyCap; // USDC (6 dp) this human may stake per UTC day
    }

    bytes32 public constant PASS_TYPEHASH =
        keccak256("HumanPass(address trader,uint256 nullifier,uint64 expiry,uint128 dailyCap)");

    address public owner;
    address public signer;
    address public hook;
    /// @notice Protocol-wide ceiling on any pass's daily cap.
    uint128 public maxDailyCap;

    mapping(uint256 nullifier => uint64 until) public excludedUntil;
    mapping(uint256 nullifier => mapping(uint256 day => uint256)) public stakedOn;

    event SelfExcluded(uint256 indexed nullifier, uint64 until);
    event Admitted(uint256 indexed nullifier, address indexed trader, uint256 amount, uint256 stakedToday);

    error NotOwner();
    error NotHook();
    error InvalidPass();
    error PassExpired();
    error PassNotForThisWallet();
    error SelfExcludedUntil(uint64 until);
    error StreamerCannotTradeOwnMarket();
    error DailyCapExceeded(uint256 stakedToday, uint256 cap);
    error ExclusionTooShort();

    constructor(address _signer, uint128 _maxDailyCap) EIP712("Clutch Human Pass", "1") {
        owner = msg.sender;
        signer = _signer;
        maxDailyCap = _maxDailyCap;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setHook(address _hook) external onlyOwner {
        hook = _hook;
    }

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
    }

    function setMaxDailyCap(uint128 cap) external onlyOwner {
        maxDailyCap = cap;
    }

    /// @inheritdoc IClutchGate
    function admit(address trader, uint256 amount, uint256 streamerNullifier, bytes calldata gateData)
        external
        returns (uint256)
    {
        if (msg.sender != hook) revert NotHook();
        (HumanPass memory pass, bytes memory sig) = abi.decode(gateData, (HumanPass, bytes));
        uint256 staked = _check(trader, amount, streamerNullifier, pass, sig);
        stakedOn[pass.nullifier][_today()] = staked;
        emit Admitted(pass.nullifier, trader, amount, staked);
        return pass.nullifier;
    }

    /// @notice Dry run of `admit` for the UI: returns the refusal (as revert data) or the stake after this trade.
    function preflight(address trader, uint256 amount, uint256 streamerNullifier, bytes calldata gateData)
        external
        view
        returns (uint256 stakedAfter)
    {
        (HumanPass memory pass, bytes memory sig) = abi.decode(gateData, (HumanPass, bytes));
        return _check(trader, amount, streamerNullifier, pass, sig);
    }

    /// @notice Exclude yourself for `duration` seconds (minimum one day). Can only be extended, never shortened.
    function selfExclude(HumanPass calldata pass, bytes calldata sig, uint64 duration) external {
        if (duration < 1 days) revert ExclusionTooShort();
        _verify(pass, sig);
        if (pass.trader != msg.sender) revert PassNotForThisWallet();
        _exclude(pass.nullifier, duration);
    }

    /// @notice Exclusion requested off-chain (e.g. from the account page without a wallet), relayed by the signer.
    function excludeBySigner(uint256 nullifier, uint64 duration) external {
        if (msg.sender != signer) revert InvalidPass();
        _exclude(nullifier, duration);
    }

    function hashPass(HumanPass memory pass) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(PASS_TYPEHASH, pass.trader, pass.nullifier, pass.expiry, pass.dailyCap))
        );
    }

    function stakedToday(uint256 nullifier) external view returns (uint256) {
        return stakedOn[nullifier][_today()];
    }

    function _check(address trader, uint256 amount, uint256 streamerNullifier, HumanPass memory pass, bytes memory sig)
        internal
        view
        returns (uint256 staked)
    {
        _verify(pass, sig);
        if (pass.trader != trader) revert PassNotForThisWallet();
        if (block.timestamp >= pass.expiry) revert PassExpired();
        uint64 until = excludedUntil[pass.nullifier];
        if (until > block.timestamp) revert SelfExcludedUntil(until);
        if (pass.nullifier == streamerNullifier) revert StreamerCannotTradeOwnMarket();
        uint256 cap = pass.dailyCap < maxDailyCap ? pass.dailyCap : maxDailyCap;
        staked = stakedOn[pass.nullifier][_today()] + amount;
        if (staked > cap) revert DailyCapExceeded(staked - amount, cap);
    }

    function _verify(HumanPass memory pass, bytes memory sig) internal view {
        if (ECDSA.recover(hashPass(pass), sig) != signer) revert InvalidPass();
    }

    function _exclude(uint256 nullifier, uint64 duration) internal {
        uint64 until = uint64(block.timestamp) + duration;
        if (until > excludedUntil[nullifier]) excludedUntil[nullifier] = until;
        emit SelfExcluded(nullifier, excludedUntil[nullifier]);
    }

    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
