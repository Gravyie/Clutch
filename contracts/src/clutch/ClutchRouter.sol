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

interface IClutchHookView {
    function usdc() external view returns (address);
    function lastFill() external view returns (uint256);
}

/// @title ClutchRouter
/// @notice Minimal v4 router for the two swaps Clutch makes:
///  - `back`: buy outcome shares through a ClutchHook pool. The hook trusts this router to pass `msg.sender` as the
///    trader, so a pass can only ever credit the wallet it was issued to.
///  - `swapExactIn`: a plain exact-input swap, used to top up USDC from ETH through the Blackout Guard pool.
contract ClutchRouter is IUnlockCallback {
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

    error NotPoolManager();
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

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 kind, bytes memory data) = abi.decode(raw, (uint8, bytes));
        if (kind == 0) return abi.encode(_back(abi.decode(data, (BackCall))));
        return abi.encode(_swap(abi.decode(data, (SwapCall))));
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
