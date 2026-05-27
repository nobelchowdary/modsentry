import { reddit } from '@devvit/web/server';
import { redis } from '@devvit/web/server';
import { extractStylometric } from '../features/stylometric.js';
import { extractBehavioral, type PostRecord } from '../features/behavioral.js';
import { extractMetadata, type UserRecord } from '../features/metadata.js';
import { getAllFingerprints, getSubConfig } from '../fingerprint/storage.js';
import { scoreMatch, explainMatch } from './score.js';
import { buildEvidenceCard } from '../modqueue/evidence.js';
import { isWhitelisted } from '../modqueue/actions.js';
import { getRegistryFingerprints } from '../registry/registry.js';
import type { Fingerprint } from '../types.js';

const MAX_HISTORY = 50;
const ACCOUNT_AGE_GATE_DAYS = 90;
const KARMA_GATE = 500;

export interface ScreenResult {
  userId: string;
  username: string;
  topMatch: {
    bannedUsername: string;
    bannedUserId: string;
    score: number;
    explanation: ReturnType<typeof explainMatch>;
  } | null;
  skipped: boolean;
  skipReason?: string;
}

export async function screenUser(
  userId: string,
  username: string,
  subreddit: string,
  contentId: string,
): Promise<ScreenResult> {

  // ── 1. Whitelist check ────────────────────────────────────────────────────
  const whitelisted = await isWhitelisted(subreddit, userId);
  if (whitelisted) {
    return { userId, username, topMatch: null, skipped: true, skipReason: 'Whitelisted' };
  }

  // ── 2. Eligibility gate ───────────────────────────────────────────────────
  const user = await reddit.getUserByUsername(username);
  if (!user) {
    return { userId, username, topMatch: null, skipped: true, skipReason: 'User not found' };
  }

  const accountAgeDays = (Date.now() / 1000 - Math.floor(user.createdAt.getTime() / 1000)) / 86400;
  const isNewAccount = accountAgeDays < ACCOUNT_AGE_GATE_DAYS;
  const totalKarma = (user.commentKarma ?? 0) + (user.linkKarma ?? 0);
  const isLowKarma = totalKarma < KARMA_GATE;

  if (!isNewAccount && !isLowKarma) {
    return { userId, username, topMatch: null, skipped: true, skipReason: 'Established user' };
  }

  // ── 3. Build candidate fingerprint ───────────────────────────────────────
  const [commentsListing, postsListing] = await Promise.all([
    reddit.getCommentsByUser({ username, limit: MAX_HISTORY }),
    reddit.getPostsByUser({ username, limit: MAX_HISTORY }),
  ]);

  const comments = await commentsListing.all();
  const posts = await postsListing.all();

  const allTexts = [
    ...comments.map((c: any) => c.body ?? ''),
    ...posts.map((p: any) => `${p.title ?? ''} ${p.selftext ?? ''}`),
  ].filter(t => t.trim().length > 0);

  const allRecords: PostRecord[] = [
    ...comments.map((c: any) => ({
      createdAt: Math.floor(new Date(c.createdAt).getTime() / 1000),
      subreddit: c.subredditName ?? subreddit,
      isTopLevel: !(c.parentId ?? '').startsWith('t1_'),
    })),
    ...posts.map((p: any) => ({
      createdAt: Math.floor(new Date(p.createdAt).getTime() / 1000),
      subreddit: p.subredditName ?? subreddit,
      isTopLevel: true,
    })),
  ];

  const userRecord: UserRecord = {
    createdAt: Math.floor(user.createdAt.getTime() / 1000),
    commentKarma: user.commentKarma ?? 0,
    postKarma: user.linkKarma ?? 0,
    username: user.username,
    hasVerifiedEmail: user.hasVerifiedEmail ?? false,
    iconImg: (user as any).iconImage ?? '',
  };

  const now = Math.floor(Date.now() / 1000);

  const candidate: Fingerprint = {
    userId,
    username,
    subreddit,
    stylometric: extractStylometric(allTexts),
    behavioral: extractBehavioral(allRecords),
    metadata: extractMetadata(userRecord, now),
    capturedAt: now,
    banReason: '',
    confirmedAltsCount: 0,
    status: allTexts.length >= 5 ? 'active' : 'low-confidence',
    postCount: allTexts.length,
  };

  // ── 4. Score against all active fingerprints (local + registry) ───────────
  const config = await getSubConfig(subreddit);
  const [localFingerprints, registryFingerprints] = await Promise.all([
    getAllFingerprints(subreddit),
    getRegistryFingerprints(subreddit),
  ]);

  const allFingerprintMap = new Map<string, Fingerprint>();
  for (const fp of registryFingerprints) allFingerprintMap.set(fp.userId, fp);
  for (const fp of localFingerprints) allFingerprintMap.set(fp.userId, fp);
  const fingerprints = [...allFingerprintMap.values()];
  const active = fingerprints.filter(f => f.status === 'active');

  if (active.length === 0) {
    return { userId, username, topMatch: null, skipped: true, skipReason: 'No active fingerprints' };
  }

  let topScore = 0;
  let topFingerprint: Fingerprint | null = null;

  for (const fp of active) {
    if (fp.userId === userId) continue;
    const score = scoreMatch(candidate, fp);
    if (score > topScore) {
      topScore = score;
      topFingerprint = fp;
    }
  }

  if (!topFingerprint || topScore < config.thresholdSoft) {
    return { userId, username, topMatch: null, skipped: false };
  }

  // ── 5. Log the match ──────────────────────────────────────────────────────
  const logKey = `evasion:${subreddit}:matches:${userId}:${Date.now()}`;
  await redis.set(logKey, JSON.stringify({
    candidateId: userId,
    candidateUsername: username,
    matchedUserId: topFingerprint.userId,
    matchedUsername: topFingerprint.username,
    score: topScore,
    contentId,
    checkedAt: now,
  }));

  console.log(`[ModSentry] Match: u/${username} vs u/${topFingerprint.username} - score: ${topScore}`);

  const result: ScreenResult = {
    userId,
    username,
    topMatch: {
      bannedUsername: topFingerprint.username,
      bannedUserId: topFingerprint.userId,
      score: topScore,
      explanation: explainMatch(candidate, topFingerprint),
    },
    skipped: false,
  };

  // ── 6. Send Evidence Card if above hard threshold ─────────────────────────
  if (topScore >= config.thresholdHard) {

    await redis.hSet(`evasion:${subreddit}:pending:${username}`, {
      userId,
      matchedUserId: topFingerprint.userId,
      matchedUsername: topFingerprint.username,
      score: String(topScore),
      banReason: topFingerprint.banReason,
      detectedAt: String(now),
    });

    const contentUrl = `https://reddit.com/r/${subreddit}/comments/${contentId}`;
    const card = buildEvidenceCard(result, contentUrl);

    try {
      await reddit.sendPrivateMessage({
        to: `/r/${subreddit}`,
        subject: `ModSentry Alert: u/${username} may be an alt (score: ${topScore}/100)`,
        text: card,
      });
      console.log(`[ModSentry] Evidence Card sent to r/${subreddit} modmail`);
    } catch (err) {
      console.error('[ModSentry] Failed to send Evidence Card:', err);
    }

    // ── 7. Auto-remove if enabled and score above 95 ──────────────────────
    if (config.autoAction && topScore >= 95) {
      try {
        if (contentId.startsWith('t1_')) {
          const comment = await reddit.getCommentById(contentId as any);
          await comment.remove();
        } else {
          const post = await reddit.getPostById(contentId as any);
          await post.remove();
        }
        console.log(`[ModSentry] Auto-removed content ${contentId} for u/${username}`);
      } catch (err) {
        console.error('[ModSentry] Auto-remove failed:', err);
      }
    }
  }

  return result;
}