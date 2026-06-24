# AGENTS.md — Agentic Workflow & Codebase Standards
*Version 1.0.0 (Production Active)*

This document is the single source of truth for coding agents operating within the `gobitsnbytes/bitsnbytes-discord-utility` codebase. **All AI assistants and agents must read and strictly adhere to these instructions before making any architectural decisions, generating code, or proposing changes.**

---

## 🚀 Project Overview
The BnB Bot is the internal operations layer for the Bits&Bytes Discord server. It acts as a bridge between Discord interactions/activities and Notion workspaces.
Key features include:
*   **Fork network lifecycle management**: Submission, onboarding tracking, event proposal pipeline, team structure validation, and archiving.
*   **Performance metrics**: Dynamic 0-100 health scoring and automated weekly leaderboard updates.
*   **Gamification**: Experience points (XP) calculation, leveling system, and achievement badges tracking.
*   **Voice/Meeting Agent**: Secure temporary voice channel creation, recording, and Hinglish/multilingual transcription using Gemini.
*   **Integrations**: Bidirectional sync between Notion databases and Cal.com booking webhooks.

---

## 📁 Repository Structure
*   [`commands/`](file:///d:/Bits-bytes-bot/commands): Slash command implementations (discord.js module layout with `data` and `execute`).
*   [`events/`](file:///d:/Bits-bytes-bot/events): Event handlers registered by client dynamically at boot (interaction creation, reaction hooks, voice state modifications).
*   [`jobs/`](file:///d:/Bits-bytes-bot/jobs): Cron jobs executed via `node-cron` for periodic reports, checks, and reminders.
*   [`lib/`](file:///d:/Bits-bytes-bot/lib): Main domain libraries:
    *   [`auth.js`](file:///d:/Bits-bytes-bot/lib/auth.js): Access control & hierarchy checks.
    *   [`db.js`](file:///d:/Bits-bytes-bot/lib/db.js) / [`meetingsDb.js`](file:///d:/Bits-bytes-bot/lib/meetingsDb.js): SQLite (local) and Turso (remote) data layer handlers.
    *   [`notion.js`](file:///d:/Bits-bytes-bot/lib/notion.js): Notion client integrations.
    *   [`gamification.js`](file:///d:/Bits-bytes-bot/lib/gamification.js): Badge awarding and points calculations.
    *   [`healthScore.js`](file:///d:/Bits-bytes-bot/lib/healthScore.js): Scoring algorithm logic.
    *   [`transcriber.js`](file:///d:/Bits-bytes-bot/lib/transcriber.js) / [`transcriptionPipeline.js`](file:///d:/Bits-bytes-bot/lib/transcriptionPipeline.js): Audio-to-text processing using Gemini 3.5 Flash.
    *   [`calcomWebhook.js`](file:///d:/Bits-bytes-bot/lib/calcomWebhook.js): Webhook processors.
*   [`tests/`](file:///d:/Bits-bytes-bot/tests): Jest unit and integration tests.
*   [`deploy/`](file:///d:/Bits-bytes-bot/deploy): Deployment assets (e.g. systemd service definition).
*   [`config.js`](file:///d:/Bits-bytes-bot/config.js): Core configurations (colors, emojis, command privacy levels, recording notice).
*   [`index.js`](file:///d:/Bits-bytes-bot/index.js): Bot bootloader, initialization, dynamic commands/events/jobs loader.
*   [`server.js`](file:///d:/Bits-bytes-bot/server.js) & [`webhookServer.js`](file:///d:/Bits-bytes-bot/webhookServer.js): HTTP servers for handling auth, external requests, and Cal.com webhook integration.

---

## 🛠️ Build, Run, and Test Commands
*   **Package Manager & Runtime**: **Always use `bun`**. Never run `npm`, `yarn`, or `pnpm` commands.
*   **Install Dependencies**: `bun install`
*   **Production Deployment Install**: `bun install --production` (omits devDependencies).
*   **Register Slash Commands**: `bun run deploy-commands.js` (Must be executed once before starting the bot to publish slash commands to Discord API, although client `ready` event also attempts auto-registration).
*   **Start Local Dev Server / Bot**: `bun start` (Runs `bun run index.js`).
*   **Execute Testing Suite**: `bun test` (Uses Bun's built-in Jest-compatible test runner). Ensure tests pass before proposing pull requests.

---

## 🎨 Code Style and Conventions
*   **Modules**: CommonJS (`require` and `module.exports`).
*   **Asynchronous Flow**: Strict use of `async/await` and Promisified APIs over nested callbacks.
*   **Indentation**: Codebase standard is tab characters (width: 4).
*   **Job Isolation**: All background jobs loaded via `index.js` must be initialized using `safeStartJob()` wrapper to prevent single job initialization errors from halting the application runtime.
*   **Embed Handling**: Custom console and Discord channel logging uses standard branding/formatting via `lib/logger.js`.
*   **Formatting/Branding**: Emojis and embed colors must refer directly to configurations defined in `config.js` (`config.COLORS` and `config.EMOJIS`).

---

## 🏗️ Architecture Notes
*   **Hybrid Storage Model**: The codebase uses a dual database setup:
    1.  **Notion Databases**: Primary source of truth for Fork Registry, Team Members, Events, Reports, Reminders, and Users. The bot reads/writes directly to Notion databases.
    2.  **SQL Database**: Local SQLite (`data/bot.db`) for lightweight event, meeting, and attendee records. If `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` variables are provided in production, the SQL layer automatically connects to a remote Turso LibSQL client.
*   **Multilingual Audio Transcription**: The bot records temporary voice channel audio, merges audio files using `prism-media` and `sodium-native`, and uploads them to the Google File API. Gemini 3.5 Flash transcribes voice recordings into speaker-labeled, Hinglish/Hindi/English transcripts and outputs formatted JSON meeting briefs.
*   **Cal.com Integration**: Unified webhook/polling sync. `syncCalcomBookings` polls booking data, and `webhookServer.js` exposes `/webhooks/calcom` to handle instant scheduling notifications.

---

## 🧪 Testing Strategy
*   **Test Suite**: Powered by Jest (`tests/` directory).
*   **Command Verification**: Mock interactions (`interaction.reply`, `interaction.editReply`) to test response validation and permission rejection blocks.
*   **Database Isolation**: Tests run in an isolated test environment (mocking SQLite/Turso client queries or using a temporary memory database).
*   **Execution**: Run `pnpm test` to validate code correctness.

---

## 🛡️ Security, Access Controls & Compliance
This is production-critical software. Access control and data privacy guidelines must be strictly enforced:
*   **Command Access Control**:
    *   Staff-only actions (like archiving, onboarding modifications) must be gated using `isStaff(member, guild)` from [`lib/auth.js`](file:///d:/Bits-bytes-bot/lib/auth.js).
    *   Fork/Lead operations must verify domain authorization using `isAuthorizedForCity(user, city, guild)` or `isAuthorizedForForkId(user, forkId, guild)`.
*   **Privacy & Ephemeral Responses**:
    *   All slash command replies must respect privacy configurations. Retrieve visibility flag via `config.PRIVACY[commandName]` and pass it as `{ ephemeral: true/false }` to Discord's interaction handlers.
*   **Webhook Signature Verification**:
    *   Webhook endpoints must verify the `X-Cal-Signature-256` header. Compute the HMAC-SHA256 of the raw body payload using `CALCOM_WEBHOOK_SECRET` and perform a constant-time comparison via `crypto.timingSafeEqual`.
*   **Secrets Safeguarding**:
    *   Credentials, tokens (`DISCORD_TOKEN`, `NOTION_TOKEN`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`), and webhook secrets must be configured via environment variables inside a non-committed `.env` file (copied from `.env.example`). Never commit raw secrets or `.env` files to git.
*   **Recording Consent & Legal Disclosures**:
    *   Voice recording must play or print the correct legal consent warnings in English/Hindi as defined in `config.js` (`RECORDING.consent`) before recording starts in any voice channel.

---

## 🚦 Agent Guardrails
*   **Production Safe**: Never directly mutate production databases without testing locally first.
*   **No Code Side-Effects**: Always catch errors at the handler boundaries (e.g. inside `commands` or `jobs`) so that one failing module doesn't block other operational loops.
*   **No Raw SQLite string interpolation**: Use parameterized query arrays (e.g. `db.run(sql, [param1, param2])`) to completely prevent SQL injection attacks.
*   **Semantic Versioning**: Always bump the version string in `package.json` and config if introducing new major releases or API revisions.
*   **Documentation Maintenance**: Always write to/update the relevant markdown documentation files (`.md` files such as `CURRENT.md`, `README.md`, `DESIGN.md`) after making code changes or commits to ensure the documentation stays in lockstep with the codebase state.

---

## 🔗 Extensibility Hooks
*   **Adding Slash Commands**:
    1.  Create the command module in `commands/<command-name>.js` containing `data` (SlashCommandBuilder) and `execute` exports.
    2.  Add its visibility preference (public or ephemeral) inside the `PRIVACY` object of [`config.js`](file:///d:/Bits-bytes-bot/config.js).
    3.  Register it globally or guild-wide using `node deploy-commands.js` (or restart the bot to trigger startup registration).
*   **Hooking New Events**:
    1.  Add a file in `events/<event-name>.js` exporting `{ name, execute, once }`.
    2.  The bot automatically imports and attaches it to the Client.
*   **Adding Periodic Jobs**:
    1.  Create a cron file in `jobs/<job-name>.js` exporting a default function `(client) => { ... }`.
    2.  Register and start it in `index.js` inside the cron loader section using `safeStartJob('./jobs/<job-name>', client, '<job-name>')`.

---

## 📖 Further Reading
*   [README.md](file:///d:/Bits-bytes-bot/README.md): Setup and VPS deployment guidelines.
*   [CURRENT.md](file:///d:/Bits-bytes-bot/CURRENT.md): Detailed implementation status of core features.
*   [WEBSITE_INTEGRATION.md](file:///d:/Bits-bytes-bot/WEBSITE_INTEGRATION.md): Guide for connecting Notion database with frontend applications.
