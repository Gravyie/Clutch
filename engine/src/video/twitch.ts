import { log } from "../log";

/**
 * Twitch Helix discovery with an app access token (client-credentials; no user login involved).
 * Finds the top live streams in the games Clutch can read, so the platform fills itself with live channels.
 */
const ID = process.env.TWITCH_CLIENT_ID;
const SECRET = process.env.TWITCH_CLIENT_SECRET;
export const twitchConfigured = Boolean(ID && SECRET);

/** Games with HUDs the vision readers understand, by Clutch category. */
export const DISCOVERY_GAMES = (process.env.DISCOVERY_GAMES ?? "Counter-Strike,VALORANT,Fortnite,Apex Legends,League of Legends,Rocket League,Overwatch 2,Rainbow Six Siege")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let token: { value: string; exp: number } | undefined;

async function appToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID!, client_secret: SECRET!, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`twitch token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function helix<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { "Client-Id": ID!, Authorization: `Bearer ${await appToken()}` } });
  if (res.status === 401) token = undefined;
  if (!res.ok) throw new Error(`helix ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export interface LiveStream {
  login: string;
  name: string;
  game: string;
  title: string;
  viewers: number;
  language: string;
  thumbnail: string;
}

const gameIds = new Map<string, string>();

async function resolveGames() {
  const missing = DISCOVERY_GAMES.filter((g) => !gameIds.has(g));
  if (!missing.length) return;
  const q = missing.map((g) => `name=${encodeURIComponent(g)}`).join("&");
  const { data } = await helix<{ data: { id: string; name: string }[] }>(`games?${q}`);
  for (const g of data) gameIds.set(g.name, g.id);
}

const RERUN = /\b(rerun|re-run|vod|replay|rebroadcast|highlights?)\b/i;

/** Top live streams per supported game, excluding reruns. */
export async function discover(perGame = Number(process.env.DISCOVERY_PER_GAME ?? 3), languages = (process.env.DISCOVERY_LANGUAGES ?? "en").split(",")): Promise<LiveStream[]> {
  if (!twitchConfigured) return [];
  await resolveGames();
  const out: LiveStream[] = [];
  for (const [name, id] of gameIds) {
    try {
      const lang = languages.map((l) => `language=${l}`).join("&");
      const { data } = await helix<{ data: { user_login: string; user_name: string; game_name: string; title: string; viewer_count: number; language: string; thumbnail_url: string; type: string }[] }>(
        `streams?game_id=${id}&first=${perGame * 3}&${lang}`,
      );
      out.push(
        ...data
          .filter((s) => s.type === "live" && !RERUN.test(s.title))
          .slice(0, perGame)
          .map((s) => ({ login: s.user_login, name: s.user_name, game: s.game_name, title: s.title, viewers: s.viewer_count, language: s.language, thumbnail: s.thumbnail_url })),
      );
    } catch (e: any) {
      log.warn(`discovery ${name}`, e.message);
    }
  }
  return out;
}

/** Live viewer counts for specific channels (one request for up to 100). */
export async function viewers(logins: string[]): Promise<Map<string, { viewers: number; title: string; game: string }>> {
  const m = new Map<string, { viewers: number; title: string; game: string }>();
  if (!twitchConfigured || !logins.length) return m;
  for (let i = 0; i < logins.length; i += 100) {
    const q = logins.slice(i, i + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
    const { data } = await helix<{ data: { user_login: string; viewer_count: number; title: string; game_name: string }[] }>(`streams?${q}`);
    for (const s of data) m.set(s.user_login.toLowerCase(), { viewers: s.viewer_count, title: s.title, game: s.game_name });
  }
  return m;
}
