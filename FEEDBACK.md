# Uniswap developer feedback

From building two v4 hooks for ETHGlobal Mumbai: a custom-curve prediction market (`ClutchHook`) and a dynamic-fee
hook (`BlackoutGuardHook`, on OpenZeppelin `BaseOverrideFee`). These are things we hit, in the order we hit them.

## What worked well

- **`beforeSwapReturnDelta` is the right primitive for non-AMM pricing.** Replacing the curve with LMSR took a few
  dozen lines once the delta conventions clicked. One pool per stream with market ids in hook storage gave us
  back-to-back rounds with no per-market pool setup.
- **OpenZeppelin `uniswap-hooks`.** `BaseOverrideFee._getFee` being non-view let us update shared sequencer state on
  the swap path without a separate keeper.
- **`HookMiner` plus the CREATE2 factory** made flag-encoded addresses painless in scripts.

## Friction

1. **Taking tokens in `beforeSwap` fails for custom curves when the router settles afterwards.** The CSMM example takes
   from the PoolManager in `beforeSwap`, which only works when the PoolManager already holds that currency. In a fresh
   pool with no liquidity it reverts deep inside the token transfer, and the error comes back as `WrappedError` with
   nested bytes. The fix (mint ERC-6909 claims in `beforeSwap`, redeem later in the hook's own `unlock`) is the
   standard pattern, but no custom-curve guide says so. A sentence and a snippet in the custom-curve docs would save
   hours.
2. **`WrappedError` is hard to decode client-side.** Hook reverts reach the app as
   `WrappedError(address,bytes4,bytes,bytes)`. viem doesn't unwrap it, so every app needs its own decoder to show
   users *which rule* refused them. A tiny official helper (or ABI snippet in the docs) would help.
3. **Ownership under CREATE2.** `msg.sender` in a hook constructor is the CREATE2 factory when deploying through
   `HookMiner`, so `owner = msg.sender` silently makes the factory the owner. Worth a callout in the hook deployment guide.
4. **`BaseOverrideFee` constructor.** Subclasses must call `BaseHook(_poolManager)` rather than
   `BaseOverrideFee(_poolManager)`, which reads oddly; a pass-through constructor would be friendlier.
5. **Stack-too-deep with `via_ir`.** Compiling `PoolManager` with `via_ir = true` at 800 optimizer runs failed with a Yul
   stack error; matching v4-core's own `optimizer_runs = 44444444` fixed it. Templates could pin those settings.
6. **One pool per stream needs a marker token.** `PoolKey` has no salt, so distinct pools for the same USDC + hook need
   a distinct second currency. We deploy a tiny `StreamToken` per stream that swaps never touch. A first-class pool salt
   (or hook-defined pool id) would make "many logical markets, one hook" cleaner.
7. **Trusted routers for identity.** Because `sender` in `beforeSwap` is the router, any hook that needs the real
   trader must trust specific routers and read the trader from `hookData`. A documented convention for passing a
   verified `msgSender` through routers would make identity-aware hooks safer and composable.

## Docs we wished existed

- A worked "custom accounting + claims" example that settles *after* the hook runs.
- Guidance on L2 sequencer outages for hooks that use `block.timestamp` (catch-up blocks can be back-dated on OP
  Stack). We now anchor to `block.number` through a shared `SequencerGuard`.

Submission checklist: complete the Uniswap Developer Feedback Form (https://developers.uniswap.org/hackathon-feedback) with a link to this file.
