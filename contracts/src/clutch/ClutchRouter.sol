// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

interface IClutchHookView {
    function usdc() external view returns (address);
    function lastFill() external view returns (uint256);
}

/// @title ClutchRouter
/// @notice Minimal v4 router for the two swaps Clutch makes:
///  - `back`: buy outcome shares through a ClutchHook pool. The hook trusts this router to pass `msg.sender` as the
///    trader, so a pass can only ever credit the wallet it was issued to.
///  - `swapExactIn`: a plain exact-input swap, used to top up USDC from ETH through the Blackout Guard pool.
///  - `backWithEth`: both at once. ETH → USDC through the Blackout Guard pool, then USDC → outcome shares through the
///    ClutchHook pool, inside a single `unlock`. The USDC credit from the first swap nets against the debt from the
///    second (flash accounting), so USDC never leaves the PoolManager and the trader needs no USDC approval.
///  - `backWithEthFor`: the same, for a bet the trader *signed*, so a cross-chain intent (Relay) can deliver it from
///    any chain: the solver bridges ETH and calls this on the trader's behalf. The position always goes to the
///    signer, never to the caller. If the market can't take the bet when the ETH arrives (it locked, or a rule
///    refused it), the ETH is sent to the trader instead of reverting, so nothing is lost or stuck in the bridge.
contract ClutchRouter is IUnlockCallback, EIP712 {
    using SafeTransferLib for address;

    IPoolManager public immutable poolManager;

    struct BackCall {
        PoolKey key;
        address trader;
        uint256 marketId;
        bool yes;
        uint128 amountIn;
        uint128 minShares;
        bytes gateData;
    }

    struct SwapCall {
        PoolKey key;
        address payer;
        address recipient;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minOut;
    }

    struct EthBackCall {
        PoolKey ethKey;
        BackCall back;
        uint128 ethIn;
        uint128 minUsdc;
    }

    /// @notice A bet signed by the trader, executable by anyone (e.g. a Relay solver) before `deadline`.
    struct Bet {
        address trader;
        uint256 marketId;
        bool yes;
        uint128 minShares;
        uint64 deadline;
        uint256 nonce;
    }

    bytes32 public constant BET_TYPEHASH =
        keccak256("Bet(address trader,uint256 marketId,bool yes,uint128 minShares,uint64 deadline,uint256 nonce)");
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    event SignedBet(address indexed trader, uint256 indexed marketId, uint256 nonce, uint256 usdcIn, uint256 shares);
    event SignedBetRefunded(address indexed trader, uint256 indexed marketId, uint256 nonce, uint256 eth, bytes reason);

    error NotPoolManager();
    error NotAnEthPool();
    error BetExpired();
    error BadBetSignature();
    error NonceUsed();
    error InsufficientOutput(uint256 out, uint256 minOut);

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function back(
        PoolKey calldata key,
        uint256 marketId,
        bool yes,
        uint128 amountIn,
        uint128 minShares,
        bytes calldata gateData
    ) external returns (uint256 shares) {
        BackCall memory c = BackCall(key, msg.sender, marketId, yes, amountIn, minShares, gateData);
        shares = abi.decode(poolManager.unlock(abi.encode(uint8(0), abi.encode(c))), (uint256));
    }

    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint128 amountIn, uint128 minOut, address recipient)
        external
        payable
        returns (uint256 out)
    {
        SwapCall memory c = SwapCall(key, msg.sender, recipient, zeroForOne, amountIn, minOut);
        out = abi.decode(poolManager.unlock(abi.encode(uint8(1), abi.encode(c))), (uint256));
        if (address(this).balance > 0) msg.sender.safeTransferETH(address(this).balance);
    }

    /// @notice Bet with ETH in one transaction: the whole `msg.value` is swapped to USDC on `ethKey` (an ETH/USDC
    /// pool, e.g. the Blackout Guard pool) and all of it backs `yes` on `marketId`. Returns the USDC that went in and
    /// the shares bought. The human pass and daily cap apply to the USDC amount.
    function backWithEth(
        PoolKey calldata ethKey,
        PoolKey calldata key,
        uint256 marketId,
        bool yes,
        uint128 minUsdc,
        uint128 minShares,
        bytes calldata gateData
    ) external payable returns (uint256 usdcIn, uint256 shares) {
        if (!ethKey.currency0.isAddressZero()) revert NotAnEthPool();
        EthBackCall memory c = EthBackCall(ethKey, BackCall(key, msg.sender, marketId, yes, 0, minShares, gateData), uint128(msg.value), minUsdc);
        (usdcIn, shares) = abi.decode(poolManager.unlock(abi.encode(uint8(2), abi.encode(c))), (uint256, uint256));
        if (address(this).balance > 0) msg.sender.safeTransferETH(address(this).balance); // a price limit left ETH unspent
    }

    /// @notice Execute a signed bet with the ETH sent. Returns shares bought, or 0 if the bet was refunded.
    function backWithEthFor(
        PoolKey calldata ethKey,
        PoolKey calldata key,
        Bet calldata bet,
        bytes calldata signature,
        uint128 minUsdc,
        bytes calldata gateData
    ) external payable returns (uint256 shares) {
        if (block.timestamp > bet.deadline) revert BetExpired();
        if (nonceUsed[bet.trader][bet.nonce]) revert NonceUsed();
        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(BET_TYPEHASH, bet.trader, bet.marketId, bet.yes, bet.minShares, bet.deadline, bet.nonce))
        );
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(bet.trader, digest, signature)) revert BadBetSignature();
        nonceUsed[bet.trader][bet.nonce] = true;
        if (!ethKey.currency0.isAddressZero()) revert NotAnEthPool();

        EthBackCall memory c =
            EthBackCall(ethKey, BackCall(key, bet.trader, bet.marketId, bet.yes, 0, bet.minShares, gateData), uint128(msg.value), minUsdc);
        try poolManager.unlock(abi.encode(uint8(2), abi.encode(c))) returns (bytes memory out) {
            uint256 usdcIn;
            (usdcIn, shares) = abi.decode(out, (uint256, uint256));
            emit SignedBet(bet.trader, bet.marketId, bet.nonce, usdcIn, shares);
        } catch (bytes memory reason) {
            emit SignedBetRefunded(bet.trader, bet.marketId, bet.nonce, msg.value, reason);
        }
        // Unspent ETH (all of it, on a refund) belongs to the trader, not to whoever delivered the bet.
        if (address(this).balance > 0) bet.trader.safeTransferETH(address(this).balance);
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Clutch Router", "1");
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 kind, bytes memory data) = abi.decode(raw, (uint8, bytes));
        if (kind == 0) return abi.encode(_back(abi.decode(data, (BackCall))));
        if (kind == 2) return _backWithEth(abi.decode(data, (EthBackCall)));
        return abi.encode(_swap(abi.decode(data, (SwapCall))));
    }

    function _backWithEth(EthBackCall memory c) internal returns (bytes memory) {
        address usdc = IClutchHookView(address(c.back.key.hooks)).usdc();
        if (Currency.unwrap(c.ethKey.currency1) != usdc) revert NotAnEthPool();
        // 1. ETH -> USDC. The router is now owed `usdcOut` USDC by the PoolManager; nothing is transferred.
        BalanceDelta d = poolManager.swap(
            c.ethKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(c.ethIn)), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            ""
        );
        uint256 usdcOut = uint256(uint128(d.amount1()));
        if (usdcOut < c.minUsdc) revert InsufficientOutput(usdcOut, c.minUsdc);
        // 2. USDC -> shares. The hook takes exactly `usdcOut`, which cancels the credit from step 1.
        bool zeroForOne = Currency.unwrap(c.back.key.currency0) == usdc;
        poolManager.swap(
            c.back.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(usdcOut),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(c.back.marketId, c.back.yes, c.back.minShares, c.back.trader, c.back.gateData)
        );
        // 3. The only real transfer: the ETH the trader sent.
        poolManager.settle{value: uint256(uint128(-d.amount0()))}();
        return abi.encode(usdcOut, IClutchHookView(address(c.back.key.hooks)).lastFill());
    }

    function _back(BackCall memory c) internal returns (uint256) {
        address usdc = IClutchHookView(address(c.key.hooks)).usdc();
        bool zeroForOne = Currency.unwrap(c.key.currency0) == usdc;
        poolManager.swap(
            c.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(c.amountIn)),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(c.marketId, c.yes, c.minShares, c.trader, c.gateData)
        );
        _pay(Currency.wrap(usdc), c.trader, c.amountIn);
        return IClutchHookView(address(c.key.hooks)).lastFill();
    }

    function _swap(SwapCall memory c) internal returns (uint256 out) {
        BalanceDelta d = poolManager.swap(
            c.key,
            SwapParams({
                zeroForOne: c.zeroForOne,
                amountSpecified: -int256(uint256(c.amountIn)),
                sqrtPriceLimitX96: c.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (Currency input, Currency output) = c.zeroForOne ? (c.key.currency0, c.key.currency1) : (c.key.currency1, c.key.currency0);
        int128 inDelta = c.zeroForOne ? d.amount0() : d.amount1();
        int128 outDelta = c.zeroForOne ? d.amount1() : d.amount0();
        out = uint256(uint128(outDelta));
        if (out < c.minOut) revert InsufficientOutput(out, c.minOut);
        _pay(input, c.payer, uint256(uint128(-inDelta)));
        poolManager.take(output, c.recipient, out);
    }

    function _pay(Currency currency, address payer, uint256 amount) internal {
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            Currency.unwrap(currency).safeTransferFrom(payer, address(poolManager), amount);
            poolManager.settle();
        }
    }

    receive() external payable {}
}
