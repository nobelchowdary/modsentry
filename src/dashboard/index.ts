import { getAllFingerprints, getSubConfig } from '../fingerprint/storage.js';
import { redis } from '@devvit/web/server';

export async function renderDashboard(subreddit: string): Promise<string> {
  const [fingerprints, config] = await Promise.all([
    getAllFingerprints(subreddit),
    getSubConfig(subreddit),
  ]);

  const active = fingerprints.filter(f => f.status === 'active');
  const lowConf = fingerprints.filter(f => f.status === 'low-confidence');

  // Load stats
  const matchKeys = await redis.hGetAll(`evasion:${subreddit}:stats`) ?? {};
  const totalCaught = parseInt(matchKeys.totalCaught ?? '0');
  const totalFalsePositives = parseInt(matchKeys.totalFalsePositives ?? '0');
  const falsePositiveRate = totalCaught > 0
    ? Math.round((totalFalsePositives / totalCaught) * 100)
    : 0;
  const minutesSaved = totalCaught * 3;

  const fingerprintRows = fingerprints
    .sort((a, b) => b.confirmedAltsCount - a.confirmedAltsCount)
    .map(fp => `
      <tr>
        <td><a href="https://reddit.com/u/${fp.username}" target="_blank">u/${fp.username}</a></td>
        <td><span class="badge ${fp.status === 'active' ? 'badge-active' : 'badge-low'}">${fp.status}</span></td>
        <td>${fp.confirmedAltsCount}</td>
        <td>${fp.postCount} posts</td>
        <td>${new Date(fp.capturedAt * 1000).toLocaleDateString()}</td>
        <td>${fp.banReason.slice(0, 40)}${fp.banReason.length > 40 ? '...' : ''}</td>
      </tr>
    `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ModSentry Dashboard — r/${subreddit}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; min-height: 100vh; }
    .header { background: #1a1d27; border-bottom: 1px solid #2a2d3a; padding: 20px 32px; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 20px; font-weight: 600; color: #fff; }
    .header .sub { color: #888; font-size: 14px; margin-left: auto; }
    .container { max-width: 1100px; margin: 0 auto; padding: 32px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px; padding: 20px; }
    .stat-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #fff; }
    .stat-card .sub { font-size: 12px; color: #666; margin-top: 4px; }
    .section { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section h2 { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
    .section h2 .count { background: #2a2d3a; color: #888; font-size: 12px; padding: 2px 8px; border-radius: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 12px 12px 0; border-bottom: 1px solid #2a2d3a; }
    td { padding: 12px 12px 12px 0; border-bottom: 1px solid #1e2130; font-size: 14px; vertical-align: middle; }
    td a { color: #6b9fff; text-decoration: none; }
    td a:hover { text-decoration: underline; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 500; }
    .badge-active { background: #0d3320; color: #4ade80; }
    .badge-low { background: #2d2410; color: #fbbf24; }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .setting-item { margin-bottom: 20px; }
    .setting-item label { display: block; font-size: 13px; color: #888; margin-bottom: 8px; }
    .setting-item input[type="range"] { width: 100%; accent-color: #6b9fff; }
    .setting-item .range-value { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .setting-item input[type="checkbox"] { width: 18px; height: 18px; accent-color: #6b9fff; }
    .save-btn { background: #6b9fff; color: #000; border: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .save-btn:hover { background: #5a8fff; }
    .empty { color: #666; font-size: 14px; text-align: center; padding: 32px; }
    .shield { font-size: 24px; }
  </style>
</head>
<body>
  <div class="header">
    <span class="shield">🛡️</span>
    <h1>ModSentry Dashboard</h1>
    <span class="sub">r/${subreddit}</span>
  </div>

  <div class="container">

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Evasions caught</div>
        <div class="value">${totalCaught}</div>
        <div class="sub">all time</div>
      </div>
      <div class="stat-card">
        <div class="label">Fingerprints</div>
        <div class="value">${fingerprints.length}</div>
        <div class="sub">${active.length} active, ${lowConf.length} low-confidence</div>
      </div>
      <div class="stat-card">
        <div class="label">False positive rate</div>
        <div class="value">${falsePositiveRate}%</div>
        <div class="sub">from mod dismissals</div>
      </div>
      <div class="stat-card">
        <div class="label">Time saved</div>
        <div class="value">${minutesSaved}m</div>
        <div class="sub">estimated</div>
      </div>
    </div>

    <!-- Fingerprints -->
    <div class="section">
      <h2>Fingerprints <span class="count">${fingerprints.length}</span></h2>
      ${fingerprints.length === 0
        ? '<div class="empty">No fingerprints yet. Ban a user to capture their fingerprint.</div>'
        : `<table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Alts caught</th>
                <th>Data</th>
                <th>Captured</th>
                <th>Ban reason</th>
              </tr>
            </thead>
            <tbody>${fingerprintRows}</tbody>
          </table>`
      }
    </div>

    <!-- Settings -->
    <div class="section">
      <h2>Settings</h2>
      <form id="settings-form">
        <div class="settings-grid">
          <div>
            <div class="setting-item">
              <div class="range-value" id="soft-val">${config.thresholdSoft}</div>
              <label>Soft threshold — log silently above this score</label>
              <input type="range" min="0" max="100" value="${config.thresholdSoft}" id="soft-threshold"
                oninput="document.getElementById('soft-val').textContent = this.value">
            </div>
            <div class="setting-item">
              <div class="range-value" id="hard-val">${config.thresholdHard}</div>
              <label>Hard threshold — send Evidence Card above this score</label>
              <input type="range" min="0" max="100" value="${config.thresholdHard}" id="hard-threshold"
                oninput="document.getElementById('hard-val').textContent = this.value">
            </div>
          </div>
          <div>
            <div class="setting-item">
              <label>Auto-remove on score &gt; 95 (off by default)</label>
              <input type="checkbox" id="auto-action" ${config.autoAction ? 'checked' : ''}>
            </div>
          </div>
        </div>
        <button type="button" class="save-btn" onclick="saveSettings()">Save settings</button>
        <span id="save-status" style="margin-left:12px;font-size:13px;color:#4ade80;display:none">✓ Saved</span>
      </form>
    </div>

  </div>

  <script>
    async function saveSettings() {
      const soft = parseInt(document.getElementById('soft-threshold').value);
      const hard = parseInt(document.getElementById('hard-threshold').value);
      const auto = document.getElementById('auto-action').checked;

      const res = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subreddit: '${subreddit}', thresholdSoft: soft, thresholdHard: hard, autoAction: auto }),
      });

      if (res.ok) {
        const status = document.getElementById('save-status');
        status.style.display = 'inline';
        setTimeout(() => status.style.display = 'none', 2000);
      }
    }
  </script>
</body>
</html>`;
}