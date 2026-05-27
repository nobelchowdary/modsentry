import { reddit } from '@devvit/web/server';
import { extractStylometric } from '../features/stylometric.js';
import { extractBehavioral, type PostRecord } from '../features/behavioral.js';
import { extractMetadata, type UserRecord } from '../features/metadata.js';
import { saveFingerprint } from './storage.js';
import { pushFingerprintToRegistry } from '../registry/registry.js';
import type { Fingerprint } from '../types.js';

const MIN_POSTS_FOR_ACTIVE = 5;
const MAX_HISTORY = 100;

export async function captureFingerprint(
  userId: string,
  username: string,
  subreddit: string,
  banReason: string,
): Promise<Fingerprint> {
  console.log(`[ModSentry] Capturing fingerprint for u/${username} in r/${subreddit}`);

  const [user, commentsListing, postsListing] = await Promise.all([
    reddit.getUserByUsername(username),
    reddit.getCommentsByUser({ username, limit: MAX_HISTORY }),
    reddit.getPostsByUser({ username, limit: MAX_HISTORY }),
  ]);

  const comments = await commentsListing.all();
  const posts = await postsListing.all();

  const commentTexts = comments
    .map((c: any) => c.body ?? '')
    .filter((t: string) => t.trim().length > 0);

  const postTexts = posts
    .map((p: any) => `${p.title ?? ''}${p.selftext ? '\n' + p.selftext : ''}`)
    .filter((t: string) => t.trim().length > 0);

  const allTexts = [...commentTexts, ...postTexts];

  const commentRecords: PostRecord[] = comments.map((c: any) => ({
    createdAt: Math.floor(new Date(c.createdAt).getTime() / 1000),
    subreddit: c.subredditName ?? subreddit,
    isTopLevel: !(c.parentId ?? '').startsWith('t1_'),
  }));

  const postRecords: PostRecord[] = posts.map((p: any) => ({
    createdAt: Math.floor(new Date(p.createdAt).getTime() / 1000),
    subreddit: p.subredditName ?? subreddit,
    isTopLevel: true,
  }));

  const allRecords = [...commentRecords, ...postRecords];

  const userRecord: UserRecord = {
    createdAt: Math.floor(new Date((user?.createdAt ?? new Date())).getTime() / 1000),
    commentKarma: user?.commentKarma ?? 0,
    postKarma: user?.linkKarma ?? 0,
    username: user?.username ?? '',
    hasVerifiedEmail: user?.hasVerifiedEmail ?? false,
    iconImg: (user as any)?.iconImage ?? '',
  };

  const now = Math.floor(Date.now() / 1000);

  const fingerprint: Fingerprint = {
    userId,
    username,
    subreddit,
    stylometric: extractStylometric(allTexts),
    behavioral: extractBehavioral(allRecords),
    metadata: extractMetadata(userRecord, now),
    capturedAt: now,
    banReason,
    confirmedAltsCount: 0,
    status: allTexts.length >= MIN_POSTS_FOR_ACTIVE ? 'active' : 'low-confidence',
    postCount: allTexts.length,
  };

  // Save locally
  await saveFingerprint(subreddit, fingerprint);

  // Push to shared registry if this sub is in one
  pushFingerprintToRegistry(subreddit, fingerprint).catch(err => {
    console.error(`[ModSentry] Failed to push fingerprint to registry:`, err);
  });

  console.log(
    `[ModSentry] Saved - u/${username} | status: ${fingerprint.status} | posts: ${allTexts.length}`,
  );

  return fingerprint;
}