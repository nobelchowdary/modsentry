import { reddit } from '@devvit/web/server';
import { redis } from '@devvit/web/server';
import type { Fingerprint } from '../types.js';

// ─── Key helpers ──────────────────────────────────────────────────────────────

const teamKey = (teamId: string) => `evasion:teams:${teamId}:fingerprints`;
const memberKey = (teamId: string) => `evasion:teams:${teamId}:members`;
const subTeamKey = (sub: string) => `evasion:sub:${sub}:teamId`;

// ─── Create or join a registry ────────────────────────────────────────────────

export async function createRegistry(
  subreddit: string,
  createdBy: string,
): Promise<string> {
  const teamId = `team_${subreddit}_${Date.now()}`;

  await redis.hSet(memberKey(teamId), {
    [subreddit]: JSON.stringify({
      subreddit,
      joinedAt: Math.floor(Date.now() / 1000),
      addedBy: createdBy,
    }),
  });

  await redis.set(subTeamKey(subreddit), teamId);

  console.log(`[ModSentry] Created registry ${teamId} for r/${subreddit}`);
  return teamId;
}

export async function joinRegistry(
  subreddit: string,
  teamId: string,
  requestedBy: string,
): Promise<{ success: boolean; reason?: string }> {

  const members = await redis.hGetAll(memberKey(teamId));
  if (!members || Object.keys(members).length === 0) {
    return { success: false, reason: 'Registry not found' };
  }

  const eligible = await checkSharedModEligibility(subreddit, Object.keys(members));
  if (!eligible) {
    return {
      success: false,
      reason: 'No shared moderator with verified 30+ days tenure found across registry members',
    };
  }

  await redis.hSet(memberKey(teamId), {
    [subreddit]: JSON.stringify({
      subreddit,
      joinedAt: Math.floor(Date.now() / 1000),
      addedBy: requestedBy,
    }),
  });

  await redis.set(subTeamKey(subreddit), teamId);

  console.log(`[ModSentry] r/${subreddit} joined registry ${teamId}`);
  return { success: true };
}

export async function leaveRegistry(subreddit: string): Promise<void> {
  const teamId = await redis.get(subTeamKey(subreddit));
  if (!teamId) return;

  await redis.hDel(memberKey(teamId), [subreddit]);
  await redis.del(subTeamKey(subreddit));

  console.log(`[ModSentry] r/${subreddit} left registry ${teamId}`);
}

export async function getTeamId(subreddit: string): Promise<string | null> {
  return await redis.get(subTeamKey(subreddit)) ?? null;
}

// ─── Fingerprint sharing ──────────────────────────────────────────────────────

export async function pushFingerprintToRegistry(
  subreddit: string,
  fingerprint: Fingerprint,
): Promise<void> {
  const teamId = await getTeamId(subreddit);
  if (!teamId) return;

  await redis.hSet(teamKey(teamId), {
    [fingerprint.userId]: JSON.stringify(fingerprint),
  });

  console.log(`[ModSentry] Pushed fingerprint for u/${fingerprint.username} to registry ${teamId}`);
}

export async function getRegistryFingerprints(
  subreddit: string,
): Promise<Fingerprint[]> {
  const teamId = await getTeamId(subreddit);
  if (!teamId) return [];

  const all = await redis.hGetAll(teamKey(teamId));
  if (!all) return [];

  return Object.values(all).map(v => JSON.parse(v) as Fingerprint);
}

export async function getRegistryMembers(
  subreddit: string,
): Promise<string[]> {
  const teamId = await getTeamId(subreddit);
  if (!teamId) return [];

  const members = await redis.hGetAll(memberKey(teamId));
  if (!members) return [];

  return Object.keys(members);
}

// ─── Eligibility check ────────────────────────────────────────────────────────

async function checkSharedModEligibility(
  joiningSubreddit: string,
  existingSubreddits: string[],
): Promise<boolean> {
  try {
    const joiningMods = await reddit.getModerators({ subredditName: joiningSubreddit }).all();
    const joiningModNames = new Set(joiningMods.map((m: any) => m.username));

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    for (const existingSub of existingSubreddits) {
      const existingMods = await reddit.getModerators({ subredditName: existingSub }).all();

      for (const mod of existingMods) {
        if (!joiningModNames.has(mod.username)) continue;

        // addedAt missing or zero means we cannot verify tenure — skip this mod
        const addedAtRaw = (mod.modPermissions as any)?.addedAt;
        if (!addedAtRaw || addedAtRaw === 0) continue;

        const addedAt = Math.floor(new Date(addedAtRaw).getTime() / 1000);

        // Must have been a mod for 30+ days — addedAt must be before thirtyDaysAgo
        if (addedAt < thirtyDaysAgo) {
          console.log(`[ModSentry] Eligible: u/${mod.username} is shared mod with verified tenure`);
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    console.error('[ModSentry] Eligibility check failed:', err);
    return false;
  }
}