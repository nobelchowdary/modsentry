import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { FormField } from '@devvit/shared-types/shared/form.js';
import { captureFingerprint } from '../fingerprint/capture.js';
import { getAllFingerprints, getSubConfig } from '../fingerprint/storage.js';
import { createRegistry, leaveRegistry, getTeamId, getRegistryMembers } from '../registry/registry.js';

export const menu = new Hono();

// ─── Existing: Mop comments ───────────────────────────────────────────────────

const buildNukeFields = (targetId: string): FormField[] => [
  {
    name: 'targetId',
    label: 'Target ID',
    type: 'string',
    helpText: 'Auto-filled from the selected item.',
    required: true,
    defaultValue: targetId,
  },
  {
    name: 'remove',
    label: 'Remove comments',
    type: 'boolean',
    defaultValue: true,
  },
  {
    name: 'lock',
    label: 'Lock comments',
    type: 'boolean',
    defaultValue: false,
  },
  {
    name: 'skipDistinguished',
    label: 'Skip distinguished comments',
    type: 'boolean',
    defaultValue: false,
  },
];

const buildNukeForm = (title: string, targetId: string) => ({
  fields: buildNukeFields(targetId),
  title,
  acceptLabel: 'Mop',
  cancelLabel: 'Cancel',
});

menu.post('/mop-comment', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    { showForm: { name: 'mopComment', form: buildNukeForm('Mop Comments', request.targetId) } },
    200,
  );
});

menu.post('/mop-post', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    { showForm: { name: 'mopPost', form: buildNukeForm('Mop Post Comments', request.targetId) } },
    200,
  );
});

// ─── ModSentry: Fingerprint this user ────────────────────────────────────────

menu.post('/fingerprint-user', async (c) => {
  const request = await c.req.json<MenuItemRequest>();

  console.log('[ModSentry] targetId:', request.targetId);

  try {
    let authorId: string;
    let authorName: string;
    let subredditName: string;

    const isPost = request.targetId.startsWith('t3_');

    if (isPost) {
      const post = await reddit.getPostById(request.targetId as any);
      authorId = post.authorId ?? '';
      authorName = post.authorName;
      subredditName = post.subredditName;
    } else {
      const comment = await reddit.getCommentById(request.targetId as any);
      authorId = comment.authorId ?? '';
      authorName = comment.authorName;
      subredditName = comment.subredditName;
    }

    if (!authorId) {
      return c.json<UiResponse>({ showToast: '❌ Could not resolve author' }, 200);
    }

    captureFingerprint(
      authorId,
      authorName,
      subredditName,
      'Manual fingerprint by moderator',
    ).then(fp => {
      console.log(`[ModSentry] Fingerprint complete for u/${authorName} - status: ${fp.status}`);
    }).catch(err => {
      console.error(`[ModSentry] Fingerprint failed for u/${authorName}:`, err);
    });

    return c.json<UiResponse>({ showToast: `Fingerprinting u/${authorName}...` }, 200);

  } catch (err) {
    console.error('[ModSentry] fingerprint-user handler failed:', err);
    return c.json<UiResponse>({ showToast: '❌ Fingerprint failed - check mod logs' }, 200);
  }
});

// ─── ModSentry: Open dashboard ────────────────────────────────────────────────

menu.post('/open-dashboard', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const subreddit = (request as any).subreddit ?? 'modsentry_dev';

  try {
    const [fingerprints, config, teamId] = await Promise.all([
      getAllFingerprints(subreddit),
      getSubConfig(subreddit),
      getTeamId(subreddit),
    ]);

    const active = fingerprints.filter((f: any) => f.status === 'active');
    const lowConf = fingerprints.filter((f: any) => f.status === 'low-confidence');

    const topFive = [...fingerprints]
      .sort((a: any, b: any) => b.confirmedAltsCount - a.confirmedAltsCount)
      .slice(0, 5);

    const fpList = topFive.length > 0
      ? topFive.map((f: any) =>
          `• u/${f.username} — ${f.confirmedAltsCount} alts caught | ${f.postCount} posts | ${f.status}`
        ).join('\n')
      : '• No fingerprints yet — ban a user to capture their fingerprint';

    let registryLine = '• Not in a shared registry';
    if (teamId) {
      const members = await getRegistryMembers(subreddit);
      registryLine = `• Registry ID: ${teamId} | Members: ${members.join(', ')}`;
    }

    const message = [
      `🛡️ **ModSentry Dashboard — r/${subreddit}**`,
      ``,
      `**📊 Stats**`,
      `• Fingerprints: ${fingerprints.length} total (${active.length} active, ${lowConf.length} low-confidence)`,
      `• Auto-remove: ${config.autoAction ? 'ON ⚠️' : 'OFF'}`,
      ``,
      `**⚙️ Current thresholds**`,
      `• Soft (log silently): ${config.thresholdSoft}/100`,
      `• Hard (send alert): ${config.thresholdHard}/100`,
      ``,
      `**🔗 Shared registry**`,
      registryLine,
      ``,
      `**👤 Top fingerprinted users**`,
      fpList,
      ``,
      `**🔧 Mod commands**`,
      `• Reply \`!ms-ban\` to an alert to confirm alt and ban`,
      `• Reply \`!ms-clear\` to an alert to whitelist`,
      `• Reply \`!ms-watch\` to an alert to keep monitoring`,
      ``,
      `*Sent by ModSentry*`,
    ].join('\n');

    await reddit.sendPrivateMessage({
      to: `/r/${subreddit}`,
      subject: `ModSentry Dashboard — r/${subreddit}`,
      text: message,
    });

    return c.json<UiResponse>({ showToast: '📊 Dashboard sent to modmail' }, 200);

  } catch (err) {
    console.error('[ModSentry] Dashboard failed:', err);
    return c.json<UiResponse>({ showToast: '❌ Dashboard failed - check logs' }, 200);
  }
});

// ─── ModSentry: Create shared registry ───────────────────────────────────────

menu.post('/create-registry', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const subreddit = (request as any).subreddit ?? 'modsentry_dev';

  try {
    const existing = await getTeamId(subreddit);
    if (existing) {
      return c.json<UiResponse>(
        { showToast: `Already in registry: ${existing}` },
        200,
      );
    }

    const user = await reddit.getCurrentUser();
    const teamId = await createRegistry(subreddit, user?.username ?? 'moderator');

    return c.json<UiResponse>(
      { showToast: `✅ Registry created! ID: ${teamId} — share this with other mods` },
      200,
    );
  } catch (err) {
    console.error('[ModSentry] Create registry failed:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to create registry' }, 200);
  }
});

// ─── ModSentry: Join shared registry ─────────────────────────────────────────

menu.post('/join-registry', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const subreddit = (request as any).subreddit ?? 'modsentry_dev';

  return c.json<UiResponse>(
    {
      showForm: {
        name: 'joinRegistry',
        form: {
          title: 'Join Shared Registry',
          acceptLabel: 'Join',
          cancelLabel: 'Cancel',
          fields: [
            {
              name: 'teamId',
              label: 'Registry ID',
              type: 'string',
              helpText: 'Enter the registry ID shared by another mod team.',
              required: true,
              defaultValue: '',
            },
            {
              name: 'subreddit',
              label: 'Subreddit',
              type: 'string',
              helpText: 'Auto-filled.',
              required: true,
              defaultValue: subreddit,
            },
          ],
        },
      },
    },
    200,
  );
});

// ─── ModSentry: Leave shared registry ────────────────────────────────────────

menu.post('/leave-registry', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const subreddit = (request as any).subreddit ?? 'modsentry_dev';

  try {
    const teamId = await getTeamId(subreddit);
    if (!teamId) {
      return c.json<UiResponse>({ showToast: 'Not currently in a registry' }, 200);
    }

    await leaveRegistry(subreddit);

    return c.json<UiResponse>(
      { showToast: `✅ Left registry ${teamId}` },
      200,
    );
  } catch (err) {
    console.error('[ModSentry] Leave registry failed:', err);
    return c.json<UiResponse>({ showToast: '❌ Failed to leave registry' }, 200);
  }
});