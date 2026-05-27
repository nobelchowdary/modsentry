import { redis } from '@devvit/web/server';
import type { Fingerprint, SubConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';

// One hash per subreddit holds all fingerprints
// Key: evasion:{sub}:fingerprints  Field: {userId}  Value: JSON
const fpHashKey = (sub: string) => `evasion:${sub}:fingerprints`;
const configKey = (sub: string) => `evasion:${sub}:config`;

export async function saveFingerprint(
  subreddit: string,
  fingerprint: Fingerprint,
): Promise<void> {
  await redis.hSet(fpHashKey(subreddit), {
    [fingerprint.userId]: JSON.stringify(fingerprint),
  });
}

export async function getFingerprint(
  subreddit: string,
  userId: string,
): Promise<Fingerprint | null> {
  const raw = await redis.hGet(fpHashKey(subreddit), userId);
  if (!raw) return null;
  return JSON.parse(raw) as Fingerprint;
}

export async function getAllFingerprints(
  subreddit: string,
): Promise<Fingerprint[]> {
  const all = await redis.hGetAll(fpHashKey(subreddit));
  if (!all) return [];
  return Object.values(all).map(v => JSON.parse(v) as Fingerprint);
}

export async function deleteFingerprint(
  subreddit: string,
  userId: string,
): Promise<void> {
  await redis.hDel(fpHashKey(subreddit), [userId]);
}

export async function getSubConfig(subreddit: string): Promise<SubConfig> {
  const raw = await redis.get(configKey(subreddit));
  if (!raw) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<SubConfig>) };
}

export async function saveSubConfig(
  subreddit: string,
  config: SubConfig,
): Promise<void> {
  await redis.set(configKey(subreddit), JSON.stringify(config));
}