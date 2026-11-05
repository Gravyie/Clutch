# Architecture

```mermaid
flowchart TB
  subgraph Inputs["Live inputs"]
    TV["Lichess TV feed<br/>(which game is featured)"]
    A["Source A · /api/stream/game/{id}<br/>push: FEN, last move, clocks"]
    B["Source B · /game/export/{id}<br/>poll: SAN, clocks, status, winner"]
    TW["Twitch embed (optional)<br/>viewer latency telemetry"]
  end

  subgraph Engine["Engine (Node) · one agent"]
    M["Moment engine<br/>features → eligible templates → validator<br/>→ 0G Router picks template + pYes"]
    R["Resolver<br/>rule on A and on B separately<br/>same facts + same verdict, else VOID"]
    E["Evidence<br/>0G SDK Merkle root → 0G Storage"]
    P["Human-pass signer<br/>World ID verify → EIP-712 pass"]
    WS["HTTP + WebSocket"]
  end

  subgraph Chain["Uniswap v4 on an L2"]
    H["ClutchHook<br/>LMSR curve · forward-only rule<br/>gate · settle / void"]
    G["HumanPassGate<br/>nullifier caps · exclusion · streamer bar"]
    V["LPVault (ERC-4626)<br/>funds b·ln(1/min(p,1−p)) per market"]
    SG["SequencerGuard<br/>chain-level phase, block-anchored"]
    BG["BlackoutGuardHook<br/>ETH/USDC recovery auction"]
    RT["ClutchRouter"]
  end

  subgraph People
    VW["Viewer app + OBS overlay"]
    ST["Streamer studio"]
    LP["LP vault page"]
  end

  TV --> A & B
  A --> M & R
  B --> R
  M -- "openMarket(ruleHash, lock, window, b, pYes)" --> H
  R --> E
  E -- "resolve(id, verdict, evidenceRoot)" --> H
  H --> G
  H <--> V
  H --> SG
  BG --> SG
  VW -- "back() / swapExactIn()" --> RT --> H & BG
  VW <--> WS
  P --> VW
  TW --> WS
  ST --> WS
  LP --> V
```

## Market lifecycle

| Phase | Time | Enforced by |
|---|---|---|
| Open | engine spots a moment; `openMarket` commits rule hash, lock, window, opening price; vault funds the worst case | `ClutchHook.openMarket`: uncertainty band, one live market per stream, Normal sequencer |
| Trading | now < lock (about 18 s) | `beforeSwap`: trusted router, market open, before lock, Normal sequencer, gate admits the human |
| Buffer | lock → lock + stream latency (8 s native board; 1.5× p95 viewer delay for Twitch) | `windowStart ≥ lockTime + latencyBuffer` or `openMarket` reverts |
| Window | the game plays; both sources record | the engine records first-observed time per ply |
| Resolve | as soon as both sources give a final evaluation, or VOID 45 s after window end | `resolve`: not before window start; Blackout overlap forces VOID |
| Settled / void | winners `claim` 1 USDC per share; VOID refunds cost incl. fees | `claim`, `expire` (anyone, 1 h after window end) |

## Money flow per market

- Stake `x` → fee `2%·x` (held until resolution) + `0.98·x` into the LMSR curve.
- Resolution (YES/NO): winners are paid from the pot (`collected + subsidy`). Leftover plus 50% of fees goes to the vault;
  25% of fees to the streamer, 12.5% to the resolver agent, 12.5% to the protocol.
- VOID: every trader is refunded their full cost; the subsidy returns to the vault untouched.
- Solvency: `collected + subsidy ≥ winning shares` for any trade sequence (proof in `LMSR.sol`, fuzzed in
  `testFuzz_solvency`). Fills round down by 1e−6 shares so fixed-point error always favours the pot.

## Why these boundaries

- **The rule decides, not the model.** The AI only selects a template and a price. `evaluate()` is deterministic
  code over facts both sources emit, so a dispute can only be "the data was wrong", and the evidence bundle is public.
- **The hook holds the money and the rules.** Everything integrity-critical (forward window, caps, exclusion,
  streamer bar, blackout void, solvency) is enforced onchain; the app only explains refusals.
- **One SequencerGuard per chain.** Sequencer state is chain-level, so every hook that cares reads the same anchor.
