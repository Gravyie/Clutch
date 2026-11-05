import { Chess } from "chess.js";
import { EventEmitter } from "node:events";
import { materialFromFen, type ChessFacts, type GameStatus, type Ply, type Side } from "@clutch/shared";
import { log } from "../log";

const UA = { "User-Agent": "clutch-hackathon (ETHGlobal Mumbai)" };

/** Reads an NDJSON stream line by line until aborted. */
async function* ndjson(url: string, signal: AbortSignal): AsyncGenerator<any> {
  const res = await fetch(url, { headers: UA, signal });
  if (!res.ok || !res.body) throw new Error(`${url} → ${res.status}`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
}

const mapStatus = (s: unknown): GameStatus => {
  const name = typeof s === "string" ? s : (s as any)?.name;
  if (!name || name === "created" || name === "started") return "started";
  if (["mate", "resign", "outoftime", "draw", "stalemate", "timeout", "aborted"].includes(name)) return name as GameStatus;
  if (name === "noStart") return "aborted";
  return "unknown";
};

export interface Source extends EventEmitter {
  readonly name: string;
  facts(): ChessFacts | undefined;
  stop(): void;
  /** Sources that cost API calls only run while a market needs them. */
  setActive?(on: boolean): void;
}

/**
 * Source A: Lichess push stream for one game (`/api/stream/game/{id}`). Replays history, then pushes each move
 * with FEN, last move and clocks. We rebuild SAN and material from the FEN sequence ourselves.
 *
 * One connection per game, shared by everyone who needs it (a channel and a market resumed after restart may both
 * want the same game) and reference-counted, because Lichess rate-limits duplicate streams. Reconnects with backoff
 * and keeps first-observed times across reconnects.
 */
export class LichessStreamSource extends EventEmitter implements Source {
  readonly name = "lichess:tv-stream";
  private static live = new Map<string, LichessStreamSource>();
  private f?: ChessFacts;
  private ctl = new AbortController();
  private refs = 0;
  private seed: Ply[];

  /** Get (or start) the shared stream for a game. `seed` restores first-observed times after an engine restart. */
  static open(gameId: string, seed: Ply[] = []): LichessStreamSource {
    let s = LichessStreamSource.live.get(gameId);
    if (!s) {
      s = new LichessStreamSource(gameId, seed);
      LichessStreamSource.live.set(gameId, s);
    }
    s.refs++;
    return s;
  }

  private constructor(readonly gameId: string, seed: Ply[]) {
    super();
    this.setMaxListeners(50);
    this.seed = seed;
    void this.run();
  }

  facts() {
    return this.f;
  }

  stop() {
    if (--this.refs > 0) return;
    LichessStreamSource.live.delete(this.gameId);
    this.ctl.abort();
  }

  private async run() {
    let backoff = 2000;
    while (!this.ctl.signal.aborted) {
      // On reconnect the stream replays history again: rebuild plies, keeping the times we already observed.
      if (this.f?.plies.length) this.seed = this.f.plies;
      const chess = new Chess();
      if (this.f) this.f.plies = [];
      try {
        for await (const msg of ndjson(`https://lichess.org/api/stream/game/${this.gameId}`, this.ctl.signal)) {
          backoff = 2000;
          if (msg.id) {
            // Game header (first line, and again at the end with the final status).
            const p = msg.players ?? {};
            this.f ??= {
              gameId: this.gameId,
              plies: [],
              status: "started",
              white: { name: p.white?.user?.name ?? p.white?.name ?? "White", rating: p.white?.rating, title: p.white?.user?.title },
              black: { name: p.black?.user?.name ?? p.black?.name ?? "Black", rating: p.black?.rating, title: p.black?.user?.title },
              speed: msg.speed,
              clock: msg.clock ? { initial: msg.clock.initial, increment: msg.clock.increment } : undefined,
            } as ChessFacts;
            const st = mapStatus(msg.status);
            if (st !== "started") {
              this.f.status = st;
              this.f.winner = msg.winner as Side | undefined;
              this.f.endedAt ??= Date.now();
              this.emit("update", this.f);
            }
            continue;
          }
          if (!this.f) continue;
          if (msg.wc !== undefined) {
            this.f.whiteMs = msg.wc * 1000;
            this.f.blackMs = msg.bc * 1000;
          }
          if (msg.lm && msg.fen) {
            const san = applyMove(chess, msg.lm, msg.fen);
            const i = this.f.plies.length;
            const at = this.seed[i]?.uci.slice(0, 4) === msg.lm.slice(0, 4) ? this.seed[i].at : Date.now();
            this.f.plies.push({ uci: msg.lm, san, at, fenAfter: msg.fen, material: materialFromFen(msg.fen), whiteMs: this.f.whiteMs, blackMs: this.f.blackMs });
            this.emit("update", this.f);
          }
        }
        // The stream closes when the game is over.
        if (this.f && this.f.status !== "started") break;
      } catch (e: any) {
        if (e.name === "AbortError") break;
        const limited = String(e.message).includes("429");
        log.warn(`source A ${this.gameId}: ${limited ? "rate limited" : e.message}; reconnecting`);
        backoff = limited ? 61_000 : Math.min(backoff * 2, 30_000);
      }
      if (!this.ctl.signal.aborted) await new Promise((r) => setTimeout(r, backoff));
    }
    this.emit("closed");
  }
}

/** Plays a UCI move on `chess`, inferring an unstated promotion piece from the resulting FEN. Returns SAN. */
function applyMove(chess: Chess, uci: string, fenAfter: string): string {
  const board = (f: string) => f.split(" ")[0];
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  for (const promotion of uci[4] ? [uci[4]] : [undefined, "q", "r", "b", "n"]) {
    try {
      const mv = chess.move({ from, to, promotion });
      if (board(chess.fen()) === board(fenAfter)) return mv.san;
      chess.undo();
    } catch {}
  }
  chess.load(fenAfter);
  return uci;
}

/**
 * Source B: Lichess REST export (`/game/export/{id}`), polled and replayed independently with chess.js.
 * Different transport, different code path, different clock: a stuck or wrong push stream can't settle a market.
 */
export class LichessExportSource extends EventEmitter implements Source {
  readonly name = "lichess:rest-export";
  private f?: ChessFacts;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private active = false;
  private backoffUntil = 0;

  /** Source B polls only while a market needs it (window and resolution), to stay well inside Lichess rate limits. */
  constructor(readonly gameId: string, private readonly intervalMs = 2500) {
    super();
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    clearTimeout(this.timer);
    if (on) void this.poll();
  }

  /** Restored first-observed times (after an engine restart), so B keeps the original timeline. */
  seed?: Ply[];

  facts() {
    return this.f;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async poll() {
    if (this.stopped || !this.active) return;
    if (Date.now() >= this.backoffUntil) {
      try {
        const res = await fetch(`https://lichess.org/game/export/${this.gameId}?moves=true&clocks=true`, {
          headers: { ...UA, Accept: "application/json" },
        });
        if (res.status === 429) this.backoffUntil = Date.now() + 60_000;
        else if (res.ok) this.ingest(await res.json());
      } catch (e: any) {
        log.warn("source B poll failed", e.message);
      }
    }
    if (this.f && this.f.status !== "started") this.emit("closed");
    if (this.active && !this.stopped) this.timer = setTimeout(() => void this.poll(), this.intervalMs);
  }

  private ingest(g: any) {
    const prev = this.f?.plies ?? this.seed ?? [];
    const sans: string[] = g.moves ? String(g.moves).split(" ") : [];
    const clocks: number[] = g.clocks ?? [];
    const chess = new Chess();
    const plies: Ply[] = [];
    for (let i = 0; i < sans.length; i++) {
      const mv = chess.move(sans[i]);
      const fen = chess.fen();
      // Keep first-observed times for plies we've already seen; new plies are stamped now.
      plies.push({
        uci: mv.from + mv.to + (mv.promotion ?? ""),
        san: mv.san,
        at: prev[i]?.uci.slice(0, 4) === mv.from + mv.to ? prev[i].at : Date.now(),
        fenAfter: fen,
        material: materialFromFen(fen),
        whiteMs: i % 2 === 0 ? clocks[i] * 10 : undefined,
        blackMs: i % 2 === 1 ? clocks[i] * 10 : undefined,
      });
    }
    const status = mapStatus(g.status);
    const changed = plies.length !== prev.length || status !== this.f?.status;
    this.f = {
      gameId: this.gameId,
      plies,
      status,
      winner: g.winner,
      endedAt: status !== "started" ? (this.f?.endedAt ?? Date.now()) : undefined,
      white: { name: g.players?.white?.user?.name ?? "White", rating: g.players?.white?.rating },
      black: { name: g.players?.black?.user?.name ?? "Black", rating: g.players?.black?.rating },
    };
    if (changed) this.emit("update", this.f);
  }
}

/** Follows Lichess TV for a channel and reports when the featured game changes. */
export class TvDirector extends EventEmitter {
  private ctl = new AbortController();
  current?: { id: string; orientation: Side };

  constructor(private readonly channel: string) {
    super();
    void this.loop();
  }

  stop() {
    this.ctl.abort();
  }

  private async loop() {
    while (!this.ctl.signal.aborted) {
      try {
        for await (const msg of ndjson(`https://lichess.org/api/tv/${this.channel}/feed`, this.ctl.signal)) {
          if (msg.t === "featured" && msg.d?.id !== this.current?.id) {
            this.current = { id: msg.d.id, orientation: msg.d.orientation };
            log.info("TV featured game", msg.d.id);
            this.emit("game", this.current);
          }
        }
      } catch (e: any) {
        if (e.name === "AbortError") return;
        log.warn("TV feed dropped, reconnecting", e.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Follows registered streamers on Lichess. One batched status request for everyone every 12 s; emits ("game", user,
 * gameId) when a streamer starts a new game, ("idle", user) when they stop playing.
 */
export class LichessUserWatcher extends EventEmitter {
  private users = new Set<string>();
  private playing = new Map<string, string>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly intervalMs = 12_000) {
    super();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  add(user: string) {
    this.users.add(user.toLowerCase());
    void this.poll();
  }

  remove(user: string) {
    this.users.delete(user.toLowerCase());
  }

  stop() {
    clearInterval(this.timer);
  }

  private async poll() {
    if (!this.users.size) return;
    try {
      const ids = [...this.users].slice(0, 100).join(",");
      const res = await fetch(`https://lichess.org/api/users/status?ids=${ids}&withGameIds=true`, { headers: UA });
      if (!res.ok) return;
      const rows = (await res.json()) as { id: string; playing?: boolean; playingId?: string }[];
      for (const r of rows) {
        const prev = this.playing.get(r.id);
        if (r.playingId && r.playingId !== prev) {
          this.playing.set(r.id, r.playingId);
          this.emit("game", r.id, r.playingId);
        } else if (!r.playingId && prev) {
          this.playing.delete(r.id);
          this.emit("idle", r.id);
        }
      }
    } catch (e: any) {
      log.warn("lichess user status", e.message);
    }
  }
}

/** Validates a Lichess account and returns its public profile. */
export async function lichessProfile(user: string) {
  const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(user)}`, { headers: UA });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: string; username: string; title?: string; disabled?: boolean; perfs?: Record<string, { rating: number }> };
  if (u.disabled) return null;
  return { id: u.id, username: u.username, title: u.title, blitz: u.perfs?.blitz?.rating };
}
