# BnB Bot

Internal operations bot for the Bits&Bytes Discord server. Manages the fork lifecycle, reaction roles, automod, and Notion sync.

## Setup

```bash
bun install
cp .env.example .env
# Fill in your tokens in .env
bun run deploy-commands.js   # Register slash commands (run once)
bun start                    # Start the bot
```

## VPS Deploy

1. Install [Bun](https://bun.sh) and git on the VPS:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   sudo apt-get install -y ffmpeg git
   ```
2. Clone this repo into `/opt/bits-bytes-bot`.
3. Create the `.env` file in that folder.
4. Install production dependencies:
   ```bash
   bun install --production
   ```
5. Register commands once:
   ```bash
   bun run deploy-commands.js
   ```
6. Install and start the systemd service from [`deploy/bnb-bot.service`](deploy/bnb-bot.service):
   ```bash
   sudo cp deploy/bnb-bot.service /etc/systemd/system/bnb-bot.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now bnb-bot
   ```

Useful commands:

```bash
sudo systemctl restart bnb-bot    # Restart the bot
sudo journalctl -u bnb-bot -f     # Tail live logs
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
| `/merge @user city:x` | Staff Only | Onboard a new fork lead |
| `/pulse city:x update:"..."` | @fork-lead | Post an activity update |
| `/archive city:x reason:"..."` | Staff Only | Archive a stale fork |
| `/forks` | Everyone | List all active/pending forks |
| `/fork-status` | Everyone | View complete fork status dashboard |
| `/fork-health` | Everyone | View fork health leaderboard or specific city score |
| `/fork-badges` | Everyone | View achievements and badges awarded to a fork |
| `/leaderboard` | Everyone | View the network points leaderboard |
| `/onboarding-status` | Everyone | View onboarding checklist progress |
| `/onboarding-complete` | Staff Only | Mark onboarding step complete (1-7) |
| `/event-create` | @fork-lead | Create a new event proposal |
| `/event-update` | @fork-lead | Update event status, date, or headcount |
| `/event-status` | Everyone | View upcoming and planned events |
| `/event-calendar` | Everyone | Display network-wide event calendar |
| `/team-view` | Everyone | View fork team members and composition validator |
| `/team-update` | @fork-lead | Add or remove members and roles |
| `/report-submit` | @fork-lead | Submit fork bi-weekly/monthly report |
| `/report-status` | Everyone | View report submission status across the network |
| `/meet-schedule` | Everyone | Schedule a sync session with core team members |
| `/meet-start` | Everyone | Manually start a scheduled voice meeting |
| `/meet-transcript` | Everyone | Retrieve past meeting notes, summaries, and transcripts |

## Web Scheduling Portal

The bot hosts a web scheduling portal at `cal.gobitsnbytes.org`.
- **Forced Guest Authentication:** All guests are required to authenticate with Discord before reserving a time slot.
- **Auto-Join Server:** Upon successful authentication, guests are automatically joined to the Bits&Bytes Discord server using the `guilds.join` scope.
- **Automatic VC Access:** The bot auto-provisions a private temporary voice channel for the meeting and sets explicit permission overrides to allow the guest to view and connect.
- **DMs & Delivery:** The guest receives meeting alerts via Discord DM and is delivered the meeting brief/transcript directly in their DMs when the meeting concludes.
