import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { config } from "./config";
import { log } from "./log";

const dir = join(config.dataDir, "evidence");
mkdirSync(dir, { recursive: true });

export interface Stored {
  root: `0x${string}`;
  provider: "0g" | "local";
  txHash?: string;
  uri: string;
}

/**
 * Stores an evidence bundle (rule, both sources' readings and raw facts, verdict, agent decision).
 *
 * The root is always computed with the 0G SDK's own Merkle tree, so it is the same root 0G Storage would assign;
 * with ZG_STORAGE_PRIVATE_KEY set the bundle is also uploaded to 0G and the upload tx is recorded. The root goes
 * onchain with the verdict; anyone can fetch the bundle by root and replay the rule.
 */
export async function storeEvidence(bundle: unknown): Promise<Stored> {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle, null, 1));
  const file = new MemData(bytes);
  const [tree, err] = await file.merkleTree();
  if (err || !tree) throw new Error(`merkle tree: ${err}`);
  const root = tree.rootHash() as `0x${string}`;
  writeFileSync(join(dir, `${root}.json`), bytes);
  const local: Stored = { root, provider: "local", uri: `/evidence/${root}` };

  if (!config.zgStorageKey) return local;
  try {
    const signer = new ethers.Wallet(config.zgStorageKey, new ethers.JsonRpcProvider(config.zgStorageRpc));
    const indexer = new Indexer(config.zgIndexer);
    const [res, upErr] = await indexer.upload(file, config.zgStorageRpc, signer as any);
    if (upErr) throw upErr;
    const txHash = "txHash" in res ? res.txHash : res.txHashes[0];
    log.info("evidence on 0G Storage", root, txHash);
    return { root, provider: "0g", txHash, uri: `/evidence/${root}` };
  } catch (e: any) {
    log.warn("0G upload failed; evidence kept locally", e.message ?? e);
    return local;
  }
}

export function readEvidence(root: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) return null;
  const p = join(dir, `${root}.json`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
