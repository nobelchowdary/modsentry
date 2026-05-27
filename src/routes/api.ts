import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { renderDashboard } from '../dashboard/index.js';
import { getSubConfig, saveSubConfig, getAllFingerprints } from '../fingerprint/storage.js';

export const api = new Hono();

// ─── Dashboard page ───────────────────────────────────────────────────────────

api.get('/dashboard', async (c) => {
  const subreddit = c.req.query('sub') ?? 'modsentry_dev';

  try {
    const html = await renderDashboard(subreddit);
    return c.html(html);
  } catch (err) {
    console.error('[ModSentry] Dashboard render failed:', err);
    return c.text('Dashboard error — check logs', 500);
  }
});

// ─── Save settings ────────────────────────────────────────────────────────────

api.post('/dashboard/settings', async (c) => {
  try {
    const body = await c.req.json<{
      subreddit: string;
      thresholdSoft: number;
      thresholdHard: number;
      autoAction: boolean;
    }>();

    const current = await getSubConfig(body.subreddit);
    await saveSubConfig(body.subreddit, {
      ...current,
      thresholdSoft: body.thresholdSoft,
      thresholdHard: body.thresholdHard,
      autoAction: body.autoAction,
    });

    console.log(`[ModSentry] Settings saved for r/${body.subreddit}`);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[ModSentry] Settings save failed:', err);
    return c.json({ ok: false }, 500);
  }
});

// ─── Daily stats aggregation scheduler ───────────────────────────────────────

api.post('/scheduler/daily-stats', async (c) => {
  try {
    const body = await c.req.json<{ subreddit?: { name: string } }>();
    const subreddit = body.subreddit?.name;

    if (!subreddit) {
      console.warn('[ModSentry] Daily stats scheduler called without subreddit');
      return c.json({ ok: false }, 200);
    }

    const today = new Date().toISOString().split('T')[0];
    const statsKey = `evasion:${subreddit}:stats`;
    const dateKey = `evasion:${subreddit}:stats:${today}`;

    // Read current cumulative stats
    const stats = await redis.hGetAll(statsKey);
    const totalCaught = parseInt(stats?.totalCaught ?? '0');
    const totalFalsePositives = parseInt(stats?.totalFalsePositives ?? '0');
    const minutesSaved = parseInt(stats?.minutesSaved ?? '0');

    // Get fingerprint counts
    const fingerprints = await getAllFingerprints(subreddit);
    const activeCount = fingerprints.filter(f => f.status === 'active').length;
    const lowConfCount = fingerprints.filter(f => f.status === 'low-confidence').length;

    // Write daily snapshot
    await redis.hSet(dateKey, {
      date: today,
      totalCaught: String(totalCaught),
      totalFalsePositives: String(totalFalsePositives),
      minutesSaved: String(minutesSaved),
      activeFingerprints: String(activeCount),
      lowConfFingerprints: String(lowConfCount),
      falsePositiveRate: totalCaught > 0
        ? String(Math.round((totalFalsePositives / totalCaught) * 100))
        : '0',
    });

    // Decay stale fingerprints — remove any not updated in 365 days
    const cutoff = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
    let decayed = 0;
    for (const fp of fingerprints) {
      if (fp.capturedAt < cutoff) {
        await redis.hDel(`evasion:${subreddit}:fingerprints`, [fp.userId]);
        decayed++;
      }
    }

    console.log(
      `[ModSentry] Daily stats written for r/${subreddit} — ` +
      `caught: ${totalCaught}, fp: ${totalFalsePositives}, ` +
      `fingerprints: ${activeCount} active, ${decayed} decayed`
    );

    return c.json({ ok: true });
  } catch (err) {
    console.error('[ModSentry] Daily stats aggregation failed:', err);
    return c.json({ ok: false }, 500);
  }
});