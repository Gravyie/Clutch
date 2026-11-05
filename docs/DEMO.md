# Demo script (under 4 minutes)

Setup: `pnpm dev`. Open three windows: the watch page on the projector, two phones (or two browser profiles) on
`/s/lichess-tv`, and the studio. Use `GAME_SOURCE=lichess-tv` for a live top blitz game, or `GAME_SOURCE=replay` as
the backup.

| Time | Beat | Show |
|---|---|---|
| 0:00–0:20 | **Hook.** "Millions already predict on streams with points, and the streamer decides who wins. We made it real, and made it fair." | Home page, live board, market card |
| 0:20–1:30 | **Live.** A market appears from the game. Two judges verify (dev personas or World ID) and back opposite sides. It locks; the buffer runs; the window plays; it settles. | Watch page; card slides in; odds move with each trade; verdict; Collect |
| 1:30–1:50 | **Receipt.** Rule committed before trading (hash recomputed in the browser: ✓), both sources' readings, evidence root on 0G, settlement tx, 0G request id. | `/receipt/:id` |
| 1:50–2:40 | **Integrity.** Streamer persona tries to trade: refused with the rule's name. "Take a break": switch wallet, still refused. Under-18 persona: no pass. Refused-markets log: "castles" and "rage-quits" never listed. | Session panel, refusal cards |
| 2:40–3:10 | **Blackout Guard.** Vault page → simulate an outage: sequencer goes Recovering, the ETH/USDC fee jumps to 15% and decays per block; Clutch stops trading. A market whose trading overlapped the outage settles VOID. | `/vault`, nav pill, receipt with blackout note |
| 3:10–3:40 | **How.** One line: `if (windowStart < lockTime + latencyBuffer) revert`. LMSR with worst case funded up front. Agent pays its own inference (spent vs earned). | Code, studio agent panel |
| 3:40–4:00 | **Close.** "Every moment is a market, and every settlement is provable." | Home |

Backup: `REPLAY_CORRUPT_PLY=40 GAME_SOURCE=replay pnpm engine` makes source B misread a ply, so the next market
VOIDs with "Sources disagree at ply …". This shows the two-source rule doing its job.
