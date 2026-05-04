# BnB Bot

Internal operations bot for the Bits&Bytes Discord server. Manages the fork lifecycle, reaction roles, automod, and Notion sync.

## Setup

```bash
npm install
cp .env.example .env
# Fill in your tokens in .env
node deploy-commands.js   # Register slash commands (run once)
node index.js             # Start the bot
```

## Minimal VPS Deploy

Best for a small VPS with low RAM:

1. Install Node.js 20+ and git on the VPS.
2. Clone this repo into a folder like `/opt/bits-bytes-bot`.
3. Create the `.env` file in that folder.
4. Install dependencies:
	```bash
	corepack enable
	pnpm install --prod --frozen-lockfile
	```
5. Register commands once:
	```bash
	node deploy-commands.js
	```
6. Start the bot with systemd using the sample service file in [`deploy/bnb-bot.service`](deploy/bnb-bot.service).

Useful restart command:

```bash
sudo systemctl restart bnb-bot
```

## CI/CD

This repo includes a GitHub Actions deploy workflow that SSHes into your VPS, pulls the latest code, reinstalls dependencies if needed, and restarts the systemd service.

Set these GitHub secrets:

| Secret | Meaning |
|--------|---------|
| `VPS_HOST` | Server IP or hostname |
| `VPS_USER` | SSH username |
| `VPS_SSH_KEY` | Private SSH key for the server |
| `VPS_PATH` | Repo path on the VPS |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `GUILD_ID` | Your server ID |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_FORK_REGISTRY_DB` | Notion Fork Registry database ID |
| `FORK_HANDBOOK_URL` | Link to the fork handbook |

## Commands

| Command | Role | Description |
|---------|------|-------------|
| `/fork-request` | Everyone | Submit a fork request via modal |
| `/merge @user city:x` | @team | Onboard a new fork lead |
| `/pulse city:x update:"..."` | @fork-lead | Post an activity update |
| `/archive city:x reason:"..."` | @team | Archive a stale fork |
| `/forks` | Everyone | List all active/pending forks |
