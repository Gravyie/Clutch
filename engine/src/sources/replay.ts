import { Chess } from "chess.js";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { materialFromFen, type ChessFacts, type Ply, type Side } from "@clutch/shared";
import { config } from "../config";
import type { Source } from "./lichess";

/** A recorded Lichess export (moves + clocks + result), as saved by `scripts/record-game.mjs`. */
interface Recording {
  id: string;
  moves: string;
  clocks: number[];
  status: string;
  winner?: Side;
  players: { white: { user?: { name: string }; rating?: number }; black: { user?: { name: string }; rating?: number } };
}

/**
 * Plays a recorded game back in real time (move gaps from the clock record) and exposes it as two sources.
 * Reader B lags by `lagMs`, and can be told to misread one ply (`corruptPly`) to demonstrate a VOID.
 */
export class Replay extends EventEmitter {
  readonly a: ReplaySource;
  readonly b: ReplaySource;
  readonly gameId: string;
  private timers: NodeJS.Timeout[] = [];

  constructor(file = join(config.root, "engine/fixtures/game.json"), speed = Number(process.env.REPLAY_SPEED ?? "1"), lagMs = 900) {
    super();
    const rec: Recording = JSON.parse(readFileSync(file, "utf8"));
    this.gameId = `replay-${rec.id}`;
    const header = (): ChessFacts => ({
      gameId: this.gameId,
      plies: [],
      status: "started",
      white: { name: rec.players.white.user?.name ?? "White", rating: rec.players.white.rating },
      black: { name: rec.players.black.user?.name ?? "Black", rating: rec.players.black.rating },
    });
    this.a = new ReplaySource("lichess:tv-stream", header());
    this.b = new ReplaySource("lichess:rest-export", header());

    const sans = rec.moves.split(" ");
    const chess = new Chess();
    let t = 1500;
    const corruptAt = process.env.REPLAY_CORRUPT_PLY ? Number(process.env.REPLAY_CORRUPT_PLY) : -1;
    sans.forEach((san, i) => {
      const mv = chess.move(san);
      const fen = chess.fen();
      // Time spent on this move = the mover's clock drop (centiseconds), clamped for a watchable pace.
      const prev = rec.clocks[i - 2] ?? rec.clocks[i] ?? 0;
      const spent = Math.min(Math.max((prev - (rec.clocks[i] ?? prev)) * 10, 600), 9000);
      t += i < 16 ? 350 : spent / speed;
      const ply = (lie: boolean): Ply => ({
        uci: mv.from + mv.to + (mv.promotion ?? ""),
        san: lie ? mv.san + "?" : mv.san,
        at: 0,
        fenAfter: fen,
        material: lie ? materialFromFen(fen) + 9 : materialFromFen(fen),
        whiteMs: i % 2 === 0 ? rec.clocks[i] * 10 : undefined,
        blackMs: i % 2 === 1 ? rec.clocks[i] * 10 : undefined,
      });
      this.timers.push(setTimeout(() => this.a.push(ply(false)), t));
      this.timers.push(setTimeout(() => this.b.push(ply(i === corruptAt)), t + lagMs));
    });
    const end = t + 1200;
    this.timers.push(setTimeout(() => this.a.finish(rec.status, rec.winner), end));
    this.timers.push(setTimeout(() => this.b.finish(rec.status, rec.winner), end + lagMs));
    this.timers.push(setTimeout(() => this.emit("closed"), end + lagMs + 30_000));
  }

  stop() {
    this.timers.forEach(clearTimeout);
  }
}

class ReplaySource extends EventEmitter implements Source {
  constructor(readonly name: string, private f: ChessFacts) {
    super();
  }
  facts() {
    return this.f;
  }
  push(p: Ply) {
    p.at = Date.now();
    this.f.plies.push(p);
    if (p.whiteMs !== undefined) this.f.whiteMs = p.whiteMs;
    if (p.blackMs !== undefined) this.f.blackMs = p.blackMs;
    this.emit("update", this.f);
  }
  finish(status: string, winner?: Side) {
    this.f.status = (status as ChessFacts["status"]) ?? "unknown";
    this.f.winner = winner;
    this.f.endedAt = Date.now();
    this.emit("update", this.f);
  }
  stop() {}
}
