import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { redis } from '@devvit/web/server';
import { captureFingerprint } from '../fingerprint/capture.js';
import { screenUser } from '../scorer/screen.js';
import { confirmAlt, whitelistUser, keepWatching } from '../modqueue/actions.js';

export const triggers = new Hono();

// ─── App install ──────────────────────────────────────────────────────────────

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  const subreddit = input.subreddit?.name ?? '';

  console.log('[ModSentry] Installed in r/' + subreddit);

  try {
    await reddit.sendPrivateMessage({
      to: `/r/${subreddit}`,
      subject: 'ModSentry is now active in your subreddit',
      text: [
        `🛡️ **Welcome to ModSentry!**`,
        ``,
        `ModSentry is now monitoring r/${subreddit} for ban evasion.`,
        ``,
        `**How it works:**`,
        `• When you ban a user, ModSentry automatically captures their behavioral fingerprint`,
        `• Every new account that posts is silently screened against banned fingerprints`,
        `• When a strong match is found, you will receive an alert in modmail`,
        ``,
        `**Mod actions (reply to any alert):**`,
        `• \`!ms-ban\` — confirm alt and ban`,
        `• \`!ms-clear\` — whitelist (not an alt)`,
        `• \`!ms-watch\` — keep monitoring`,
        ``,
        `**Subreddit shield menu options:**`,
        `• 🔍 Fingerprint this user — manual fingerprint on any post or comment`,
        `• 📊 Dashboard — view stats and manage settings`,
        `• 🔗 Create or join shared registry — share fingerprints across subreddits`,
        ``,
        `*ModSentry works silently in the background. No action needed to get started.*`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[ModSentry] Failed to send intro modmail:', err);
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Auto-capture fingerprint when a mod bans someone ────────────────────────

type OnModActionRequest = {
  action: string;
  targetUser?: { id: string; name: string };
  subreddit?: { name: string };
  details?: string;
};

triggers.post('/on-mod-action', async (c) => {
  const input = await c.req.json<OnModActionRequest>();

  if (input.action !== 'banuser') {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  if (!input.targetUser || !input.subreddit) {
    console.warn('[ModSentry] banuser event missing targetUser or subreddit');
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const { targetUser, subreddit, details } = input;

  captureFingerprint(
    targetUser.id,
    targetUser.name,
    subreddit.name,
    details ?? 'No reason provided',
  ).catch(err => {
    console.error(`[ModSentry] Capture failed for u/${targetUser.name}:`, String(err));
  });

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Screen new comments ──────────────────────────────────────────────────────

type OnCommentSubmitRequest = {
  author?: { id: string; name: string };
  subreddit?: { name: string };
  comment?: { id: string };
};

triggers.post('/on-comment-submit', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();

  if (!input.author || !input.subreddit) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const { author, subreddit } = input;

  screenUser(
    author.id,
    author.name,
    subreddit.name,
    input.comment?.id ?? '',
  ).then(result => {
    if (result.skipped) {
      console.log(`[ModSentry] Skipped u/${author.name} - ${result.skipReason}`);
      return;
    }
    if (result.topMatch) {
      console.log(`[ModSentry] FLAGGED u/${author.name} matches u/${result.topMatch.bannedUsername} - score: ${result.topMatch.score}`);
    } else {
      console.log(`[ModSentry] Screened u/${author.name} - no match found`);
    }
  }).catch(err => {
    console.error(`[ModSentry] Screen failed for u/${author.name}:`, String(err));
  });

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Screen new posts ─────────────────────────────────────────────────────────

type OnPostSubmitRequest = {
  author?: { id: string; name: string };
  subreddit?: { name: string };
  post?: { id: string };
};

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();

  if (!input.author || !input.subreddit) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const { author, subreddit } = input;

  screenUser(
    author.id,
    author.name,
    subreddit.name,
    input.post?.id ?? '',
  ).then(result => {
    if (result.skipped) {
      console.log(`[ModSentry] Skipped u/${author.name} - ${result.skipReason}`);
      return;
    }
    if (result.topMatch) {
      console.log(`[ModSentry] FLAGGED u/${author.name} matches u/${result.topMatch.bannedUsername} - score: ${result.topMatch.score}`);
    } else {
      console.log(`[ModSentry] Screened u/${author.name} - no match found`);
    }
  }).catch(err => {
    console.error(`[ModSentry] Screen failed for u/${author.name}:`, String(err));
  });

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Modmail reply handler ────────────────────────────────────────────────────

type OnModMailRequest = {
  messageAuthor?: { name: string };
  conversationSubject?: string;
  body?: string;
  subreddit?: { name: string };
};

triggers.post('/on-mod-mail', async (c) => {
  const input = await c.req.json<OnModMailRequest>();

  const body = (input.body ?? '').trim().toLowerCase();
  const subreddit = input.subreddit?.name;
  const modName = input.messageAuthor?.name;

  if (!subreddit || !modName) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  if (!body.startsWith('!ms-')) {
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const subject = input.conversationSubject ?? '';
  const usernameMatch = subject.match(/u\/([A-Za-z0-9_-]+) may be an alt/);
  if (!usernameMatch) {
    console.warn('[ModSentry] Could not extract username from modmail subject:', subject);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }

  const suspectUsername = usernameMatch[1];
  const matchKeys = await redis.hGetAll(`evasion:${subreddit}:pending:${suspectUsername}`);

  const suspectUserId = matchKeys?.userId ?? '';
  const matchedUserId = matchKeys?.matchedUserId ?? '';
  const banReason = matchKeys?.banReason ?? 'Ban evasion detected by ModSentry';

  console.log(`[ModSentry] Mod ${modName} issued ${body} for u/${suspectUsername}`);

  if (body === '!ms-ban') {
    await confirmAlt(subreddit, suspectUserId, suspectUsername, matchedUserId, banReason);
  } else if (body === '!ms-clear') {
    await whitelistUser(subreddit, suspectUserId, suspectUsername, matchedUserId, modName);
  } else if (body === '!ms-watch') {
    await keepWatching(subreddit, suspectUserId, matchedUserId);
  }

  return c.json<TriggerResponse>({ status: 'success' }, 200);
});