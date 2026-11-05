import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { log } from "../log";

export type Platform = "twitch" | "kick" | "youtube";

export interface Frame {
  /** wall-clock ms when the frame arrived */
  at: number;
  jpeg: Buffer;
  sha: string;
}

export interface ChannelRef {
  platform: Platform;
  /** twitch/kick login, or a YouTube channel handle (@name) or video id */
  channel: string;
}

export function streamUrl(c: ChannelRef) {
  if (c.platform === "twitch") return `https://www.twitch.tv/${c.channel}`;
  if (c.platform === "kick") return `https://kick.com/${c.channel}`;
  return c.channel.startsWith("@") ? `https://www.youtube.com/${c.channel}/live` : `https://www.youtube.com/watch?v=${c.channel}`;
}

/** Parse "twitch.tv/x", "kick.com/x", "youtube.com/@x", "youtu.be/id" … into a channel reference. */
export function parseChannel(input: string): ChannelRef | null {
  const s = input.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^m\./, "");
  let m = s.match(/^twitch\.tv\/([a-zA-Z0-9_]{3,25})/);
  if (m) return { platform: "twitch", channel: m[1].toLowerCase() };
  m = s.match(/^kick\.com\/([a-zA-Z0-9_-]{2,40})/);
  if (m) return { platform: "kick", channel: m[1].toLowerCase() };
  m = s.match(/^youtube\.com\/(@[a-zA-Z0-9_.-]{2,60})/);
  if (m) return { platform: "youtube", channel: m[1] };
  m = s.match(/^(?:youtube\.com\/(?:watch\?v=|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return { platform: "youtube", channel: m[1] };
  return null;
}

export interface StreamInfo {
  live: boolean;
  title?: string;
  game?: string;
  author?: string;
  /** "RERUN" streams replay finished matches; markets on them would be insider trading by definition */
  rerun: boolean;
}

/** Liveness and metadata via streamlink's platform plugins (no API keys needed). */
export async function probe(c: ChannelRef): Promise<StreamInfo> {
  const out = await run("streamlink", ["--json", streamUrl(c)], 25_000).catch(() => "");
  try {
    const d = JSON.parse(out);
    const md = d.metadata ?? {};
    const title: string | undefined = md.title ?? undefined;
    return { live: Boolean(d.streams), title, game: md.category ?? undefined, author: md.author ?? undefined, rerun: /\b(rerun|re-run|vod|replay|rebroadcast)\b/i.test(title ?? "") };
  } catch {
    return { live: false, rerun: false };
  }
}

/**
 * Continuous, low-resolution frame sampler for one stream: streamlink (picks the lowest decent quality) piped into
 * ffmpeg, which emits one JPEG every `intervalSec`. Restarts with backoff if the stream drops.
 */
export class FrameSampler extends EventEmitter {
  private sl?: ChildProcess;
  private ff?: ChildProcess;
  private stopped = false;
  private backoff = 3000;
  latest?: Frame;
  readonly ring: Frame[] = [];

  constructor(readonly ref: ChannelRef, private readonly opts = { intervalSec: 3, width: 896, keep: 40 }) {
    super();
  }

  start() {
    this.stopped = false;
    this.spawn();
    return this;
  }

  stop() {
    this.stopped = true;
    this.sl?.kill("SIGKILL");
    this.ff?.kill("SIGKILL");
  }

  /** Frames captured in [from, to] (ms). */
  between(from: number, to: number) {
    return this.ring.filter((f) => f.at >= from && f.at <= to);
  }

  private spawn() {
    const url = streamUrl(this.ref);
    this.sl = spawn("streamlink", ["--stdout", "--twitch-disable-ads", "--hls-live-edge", "2", url, "480p,360p,720p,worst,best"], { stdio: ["ignore", "pipe", "ignore"] });
    this.ff = spawn(
      "ffmpeg",
      ["-loglevel", "error", "-i", "pipe:0", "-vf", `fps=1/${this.opts.intervalSec},scale=${this.opts.width}:-2`, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    this.sl.stdout!.pipe(this.ff.stdin!);
    this.ff.stdin!.on("error", () => {});
    let buf = Buffer.alloc(0);
    this.ff.stdout!.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      // JPEGs start with FFD8 and end with FFD9.
      for (;;) {
        const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
        const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (start < 0 || end < 0) break;
        const jpeg = buf.subarray(start, end + 2);
        buf = buf.subarray(end + 2);
        const f: Frame = { at: Date.now(), jpeg: Buffer.from(jpeg), sha: createHash("sha256").update(jpeg).digest("hex") };
        this.backoff = 3000;
        this.latest = f;
        this.ring.push(f);
        if (this.ring.length > this.opts.keep) this.ring.shift();
        this.emit("frame", f);
      }
    });
    const onExit = () => {
      this.sl?.kill("SIGKILL");
      this.ff?.kill("SIGKILL");
      if (this.stopped) return;
      this.emit("down");
      setTimeout(() => !this.stopped && this.spawn(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    };
    this.ff.on("exit", onExit);
  }
}

/** One frame over a fresh, independent connection: the second reader's eyes. */
export async function grabFrame(ref: ChannelRef, width = 896): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const sl = spawn("streamlink", ["--stdout", "--twitch-disable-ads", "--hls-live-edge", "1", streamUrl(ref), "480p,360p,720p,worst,best"], { stdio: ["ignore", "pipe", "ignore"] });
    const ff = spawn("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-frames:v", "1", "-vf", `scale=${width}:-2`, "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    sl.stdout.pipe(ff.stdin);
    ff.stdin.on("error", () => {});
    const parts: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => parts.push(c));
    const timer = setTimeout(() => {
      sl.kill("SIGKILL");
      ff.kill("SIGKILL");
      reject(new Error("frame grab timed out"));
    }, 30_000);
    ff.on("exit", () => {
      clearTimeout(timer);
      sl.kill("SIGKILL");
      const jpeg = Buffer.concat(parts);
      if (!jpeg.length) return reject(new Error("no frame"));
      resolve({ at: Date.now(), jpeg, sha: createHash("sha256").update(jpeg).digest("hex") });
    });
  });
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    const t = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    p.on("exit", () => {
      clearTimeout(t);
      resolve(out);
    });
    p.on("error", (e) => {
      clearTimeout(t);
      log.warn(`${cmd} failed`, e.message);
      reject(e);
    });
  });
}
