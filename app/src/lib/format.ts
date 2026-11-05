export const usd = (n: number, digits = 2) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const compactUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : usd(n, n >= 100 ? 0 : 2);

/** Polymarket-style price: 0.62 → "62¢". */
export const cents = (p: number) => `${Math.round(Math.min(0.99, Math.max(0.01, p)) * 100)}¢`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;

export const short = (h?: string, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "");

export function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const clock = (ms?: number) => {
  if (ms === undefined) return "-:--";
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Deterministic hue for an address/name, for avatars. */
export function hueOf(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
