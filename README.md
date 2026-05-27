# ModSentry 🛡️

Ban-evasion and repeat-offender detection for Reddit moderators, built on the [Devvit](https://developers.reddit.com/) platform.

**[➜ Install ModSentry from the Reddit App Directory](https://developers.reddit.com/apps/modsentry)**

## What it does

When a mod bans a user, ModSentry automatically captures a behavioral and stylometric fingerprint of that user. Every new commenter or poster is then silently scored against fingerprints of previously banned users. When a match is found, the mod team receives an Evidence Card in modmail explaining in plain English why the account looks like a banned user.

## Features

- **Auto-fingerprint on ban** — no extra steps for mods
- **Silent live screening** — every new or low-karma account screened automatically
- **Evidence Cards** — plain-English explanation sent to modmail when a match is found
- **One-click mod actions** — reply `!ms-ban`, `!ms-clear`, or `!ms-watch` to any alert
- **Dashboard** — stats and fingerprint list via modmail
- **Shared registry** — share fingerprints across multiple subreddits you moderate
- **Whitelist** — permanently clear false positives with one command
- **Auto-remove** — optional auto-remove for very high confidence matches (off by default)

## How it works

### Fingerprint capture
ModSentry extracts three categories of signals from a user's post history:

- **Stylometric** — character n-grams, function word frequency, sentence length, punctuation rate, ALL CAPS rate, emoji usage, top bigrams
- **Behavioral** — posting hour/day histograms, subreddit interests, comment depth ratio, inter-post gap
- **Metadata** — account age, karma trajectory, username pattern, profile completeness

### Scoring
Matches are scored 0–100 using a weighted blend of cosine similarity and Jensen-Shannon divergence across aligned feature vectors.

### Thresholds (configurable)

| Score | Default action |
|---|---|
| Below 70 | Ignore |
| 70 – 85 | Log silently |
| 85 – 95 | Evidence Card to modmail |
| Above 95 | Optional auto-remove (off by default) |

## Mod actions

Reply to any Evidence Card modmail with:

- `!ms-ban` — confirm alt and ban
- `!ms-clear` — not an alt, whitelist permanently  
- `!ms-watch` — keep monitoring without action

## Mod menu items

**On any post or comment (shield icon):**
- 🔍 ModSentry: Fingerprint this user

**On the subreddit (shield icon):**
- 📊 ModSentry Dashboard
- 🔗 ModSentry: Create shared registry
- 🔗 ModSentry: Join shared registry
- 🚪 ModSentry: Leave shared registry

## Shared registry

Mod teams running multiple subreddits can create a shared fingerprint registry. A ban in any member subreddit automatically protects all others. Joining requires a shared moderator with 30+ days verified tenure.

## Privacy

- All data scoped to the subreddit where it was captured
- No PII stored — fingerprints derived only from public data
- Fingerprints auto-expire after 365 days of inactivity
- Mods can purge any fingerprint at any time

## Tech stack

- **Platform:** Reddit Devvit
- **Language:** TypeScript
- **Framework:** Hono
- **Storage:** Devvit-managed Redis
- **Matching:** Fully deterministic — no LLM required

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Upload to Reddit
devvit upload

# Install on a subreddit
devvit install subreddit_name

# View logs
devvit logs subreddit_name modsentry
```

## License

BSD-3-Clause