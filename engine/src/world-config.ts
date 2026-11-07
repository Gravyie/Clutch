/** Accept the dashboard's hexadecimal RP identifier and emit IDKit's canonical form. */
export function normalizeWorldRpId(value: string | undefined): string | undefined {
  const id = value?.trim();
  if (!id) return undefined;
  const hex = id.replace(/^(rp_|0x)/, "");
  if (/^(rp_|0x)[0-9a-fA-F]{1,16}$/.test(id)) return `rp_${hex.toLowerCase().padStart(16, "0")}`;
  throw new Error("WORLD_RP_ID must be the dashboard's 64-bit rp_ identifier, not a signing key, address, or 32-byte hash");
}
