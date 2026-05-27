import { reddit } from '@devvit/web/server';
import { redis } from '@devvit/web/server';
import { getFingerprint, saveFingerprint } from '../fingerprint/storage.js';

// ─── Stats helpers ────────────────────────────────────────────────────────────

async function incrementStat(subreddit: string, field: string, amount = 1): Promise<void> {
  const key = `evasion:${subreddit}:stats`;
  const raw = await redis.hGet(key, field);
  const current = parseInt(raw ?? '0');
  await redis.hSet(key, { [field]: String(current + amount) });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function confirmAlt(
  subreddit: string,
  suspectUserId: string,
  suspectUsername: string,
  matchedUserId: string,
  banReason: string,
): Promise<void> {
  console.log(`[ModSentry] Confirming alt: u/${suspectUsername} in r/${subreddit}`);

  await reddit.banUser({
    subredditName: subreddit,
    username: suspectUsername,
    reason: `Ban evasion — alt of previously banned user. ${banReason}`,
    duration: 0,
  });

  const fp = await getFingerprint(subreddit, matchedUserId);
  if (fp) {
    fp.confirmedAltsCount += 1;
    await saveFingerprint(subreddit, fp);
  }

  // Increment stats
  await incrementStat(subreddit, 'totalCaught');
  await incrementStat(subreddit, 'minutesSaved', 3);

  await logDecision(subreddit, suspectUserId, matchedUserId, 'confirmed_alt', banReason);
  console.log(`[ModSentry] Banned u/${suspectUsername} as alt of u/${fp?.username}`);
}

export async function whitelistUser(
  subreddit: string,
  userId: string,
  username: string,
  matchedUserId: string,
  addedBy: string,
): Promise<void> {
  console.log(`[ModSentry] Whitelisting u/${username} in r/${subreddit}`);

  const key = `evasion:${subreddit}:whitelist:${userId}`;
  await redis.set(key, JSON.stringify({
    userId,
    username,
    addedBy,
    addedAt: Math.floor(Date.now() / 1000),
    reason: 'Mod cleared via Evidence Card',
  }));

  // Increment false positive counter
  await incrementStat(subreddit, 'totalFalsePositives');

  await logDecision(subreddit, userId, matchedUserId, 'whitelisted', '');
  console.log(`[ModSentry] Whitelisted u/${username}`);
}

export async function isWhitelisted(
  subreddit: string,
  userId: string,
): Promise<boolean> {
  const key = `evasion:${subreddit}:whitelist:${userId}`;
  const raw = await redis.get(key);
  return raw !== null && raw !== undefined;
}

export async function keepWatching(
  subreddit: string,
  userId: string,
  matchedUserId: string,
): Promise<void> {
  await logDecision(subreddit, userId, matchedUserId, 'watching', '');
  console.log(`[ModSentry] Keeping watch on u/${userId}`);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function logDecision(
  subreddit: string,
  candidateId: string,
  matchedId: string,
  decision: 'confirmed_alt' | 'whitelisted' | 'watching',
  notes: string,
): Promise<void> {
  const key = `evasion:${subreddit}:feedback:${Date.now()}:${candidateId}`;
  await redis.set(key, JSON.stringify({
    candidateId,
    matchedId,
    decision,
    notes,
    decidedAt: Math.floor(Date.now() / 1000),
  }));
}