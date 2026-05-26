# Bits&Bytes Bot - Current Implementation Status

## Overview

The Bits&Bytes Bot is a Discord bot designed to manage the Bits&Bytes fork network. It provides comprehensive tools for tracking fork health, managing teams, organizing events, gamification, and automated reminders.

**Implementation Status:** All 8 planned features have been implemented.

---

## 📊 Feature 1: Fork Health/Performance Tracker

### Description
Tracks fork performance based on activity metrics with a dynamic 0-100 scoring system.

### Scoring Algorithm

| Metric | Points | Calculation |
|--------|--------|-------------|
| Last Pulse Recency | 0-25 | 25 pts if <7 days, 15 pts if <30 days, 5 pts if <60 days, 0 if >60 days |
| Events Conducted | 0-25 | 5 pts per event (max 25) |
| Team Size Completeness | 0-20 | Based on required roles filled |
| Report Submission | 0-15 | 5 pts per on-time report (max 15) |
| Partnerships Secured | 0-15 | 5 pts per partnership (max 15) |

### Health Status Labels

| Score Range | Status | Emoji | Color |
|-------------|--------|-------|-------|
| 80-100 | Excellent | 🟢 | Green |
| 60-79 | Good | 🟡 | Yellow |
| 40-59 | Needs Attention | 🟠 | Orange |
| 0-39 | At Risk | 🔴 | Red |

### Commands

#### `/fork-health`
Display fork health leaderboard or specific fork health.

**Options:**
- `city` (optional): View specific fork health
- `period` (optional): `week`, `month`, or `all-time`

**Example Usage:**
```
/fork-health
/fork-health city:Delhi
/fork-health period:month
```

### Automated Jobs

#### `healthWeekly.js`
Runs weekly to post:
- Top 5 performing forks
- At-risk forks (health score < 40)
- Network-wide health statistics

### Files
- `commands/fork-health.js` - Command implementation
- `lib/healthScore.js` - Scoring algorithm
- `jobs/healthWeekly.js` - Weekly automated reports

---

## 📋 Feature 2: Report Submission Tracker

### Description
Tracks bi-weekly/monthly report submissions from fork leads with automated reminders.

### Commands

#### `/report-submit`
Submit a fork report.

**Options:**
- `city` (required): Fork city
- `type` (required): `monthly` or `bi-weekly`
- `attachment` (optional): URL to PDF attachment
- `notes` (optional): Additional notes

**Example Usage:**
```
/report-submit city:Mumbai type:monthly notes:Great progress this month!
```

**Rewards:** +5 points for report submission (+2 bonus for on-time, -3 penalty for late)

#### `/report-status`
View report submission status across all forks or a specific fork.

**Options:**
- `city` (optional): Filter by specific fork

### Automated Reminders

#### `reportReminders.js`
- **48 hours before deadline:** Sends reminder to fork lead
- **Deadline missed:** Sends overdue notification
- **Monthly deadline:** Last day of each month
- **Bi-weekly deadlines:** 15th and last day of month

### Notion Integration
Reports are stored in the `NOTION_REPORTS_DB` database with:
- Fork relation
- Type (monthly/bi-weekly)
- Submitted Date
- Attachment URL
- Notes
- Status (on-time/late/missing)

### Files
- `commands/report-submit.js` - Submit reports
- `commands/report-status.js` - View report status
- `jobs/reportReminders.js` - Automated reminders

---

## 🔔 Feature 3: Smart Reminders

### Description
Contextual alerts for missing critical fork components.

### Reminder Types

| Trigger | Message |
|---------|---------|
| No team added | "You don't have a tech lead yet. This will block execution." |
| No event planned | "You haven't planned events for {month}. You'll fall behind." |
| No pulse (10+ days) | "Your fork hasn't shown activity in 10 days." |
| Missing roles | "Your fork is missing: {roles}. Recruit via #recruitment." |
| Report overdue | "Your {period} report is overdue. Submit via /report-submit." |
| Onboarding incomplete | "Complete {remaining} onboarding steps to fully activate." |

### Spam Prevention
- Maximum 1 reminder per condition per fork per week
- Tracked via `NOTION_REMINDERS_DB` database

### Logic Flow
```
1. Daily job runs at 9 AM
2. For each active fork, check all conditions
3. If condition matches and no reminder sent in 7 days, send reminder
4. Log reminder to prevent spam
```

### Files
- `lib/smartReminders.js` - Reminder logic and conditions
- `jobs/reminderCheck.js` - Daily job

---

## 📅 Feature 4: Event Proposals System

### Description
Allows fork leads to propose, update, and track events through a lifecycle.

### Event Lifecycle

```
Idea → Planned → Approved → Executing → Completed
```

### Commands

#### `/event-create`
Create a new event proposal.

**Options:**
- `title` (required): Event name
- `city` (required): Fork city
- `date` (required): Event date (YYYY-MM-DD format)
- `type` (required): `workshop`, `hackathon`, `meetup`, or `other`
- `description` (required): Event details
- `expected-attendees` (optional): Expected headcount

**Example Usage:**
```
/event-create title:"Intro to React" city:Bangalore date:2024-05-15 type:workshop description:"A beginner-friendly workshop on React fundamentals"
```

**Rewards:** +2 points for creating an event

#### `/event-update`
Update an existing event.

**Options:**
- `event-id` (required): Event to update
- `status` (optional): New status (Idea/Planned/Approved/Executing/Completed)
- `date` (optional): New date
- `attendees` (optional): Actual attendees count

**Rewards:** +10 points when event is marked Completed, -5 if Cancelled

#### `/event-status`
View event pipeline for your fork or all forks.

**Options:**
- `city` (optional): Filter by fork
- `status` (optional): Filter by status

#### `/event-calendar`
Network-wide event calendar showing all upcoming events.

### Event Types & Emojis

| Type | Emoji |
|------|-------|
| Workshop | 🛠️ |
| Hackathon | 💻 |
| Meetup | 👥 |
| Other | 📌 |

### Notion Integration
Events stored in `NOTION_EVENTS_DB` with:
- Event Name (title)
- Fork (relation)
- Date
- Type
- Status
- Description
- Expected Attendees
- Actual Attendees
- Created By

### Files
- `commands/event-create.js` - Create events
- `commands/event-update.js` - Update events
- `commands/event-status.js` - View pipeline
- `commands/event-calendar.js` - Network calendar
- `lib/events.js` - Event management logic

---

## 🏆 Feature 5: Gamification System

### Description
Reward forks with points for activities and highlight top performers.

### Points System

| Activity | Points |
|----------|--------|
| Hosting event | +10 (completed) |
| Creating event | +2 |
| On-time report | +5 (base) +2 (bonus) |
| Late report | +5 (base) -3 (penalty) |
| Partnership secured | +3 |
| New member recruited | +1 |
| Pulse submitted | +1 |
| Pulse streak (4+ weeks) | +3 |
| Team complete | +5 |
| Onboarding complete | +20 |
| Monthly winner | +50 |
| Health score 80+ (weekly) | +10 |
| Health score 90+ (weekly) | +20 |

### Level System

| Level | Name | Points Required |
|-------|------|-----------------|
| 1 | Newcomer | 0 |
| 2 | Novice | 20 |
| 3 | Beginner | 50 |
| 4 | Apprentice | 100 |
| 5 | Intermediate | 150 |
| 6 | Skilled | 200 |
| 7 | Advanced | 250 |
| 8 | Expert | 300 |
| 9 | Master | 400 |
| 10 | Legend | 500 |

### Badges

#### Event Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| First Steps | 🎯 | Hosted 1 event |
| Event Hero | 🎉 | Hosted 5+ events |
| Event Legend | 🏆 | Hosted 10+ events |

#### Team Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Team Builder | 👥 | Complete team structure |
| Recruiter | 🤝 | Added 5+ team members |

#### Activity Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Pulse Master | 💓 | 8 weeks pulse streak |
| Reliable Reporter | 📝 | 10 reports on time |
| On Fire | 🔥 | 3+ consecutive active months |

#### Health Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Healthy Fork | 💚 | Health score 60+ |
| Thriving Fork | 🌟 | Health score 80+ |
| Exceptional | 💎 | Health score 95+ |

#### Partnership Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Partner Up | 🤝 | First partnership secured |
| Connected | 🌐 | 5+ partnerships |

#### Special Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Fully Onboarded | ✅ | Completed all onboarding steps |
| Monthly Champion | 👑 | Won monthly leaderboard |
| Rising Star | ⭐ | Most improved fork |
| Early Bird | 🐦 | First pulse of the week |

#### Attendance Badges
| Badge | Emoji | Requirement |
|-------|-------|-------------|
| Crowd Pleaser | 🎪 | 50+ attendees at an event |
| Packed House | 🏟️ | 100+ attendees at an event |

### Commands

#### `/leaderboard`
View fork leaderboard.

**Options:**
- `period` (optional): `month` or `all`

**Example Usage:**
```
/leaderboard
/leaderboard period:all
```

#### `/fork-badges`
View fork badges/achievements.

**Options:**
- `city` (optional): Specific fork or all

### Automated Jobs

#### `monthlyWinner.js`
- Runs on the 1st of each month
- Announces the monthly champion
- Awards the Monthly Champion badge
- Grants +50 bonus points

### Files
- `commands/leaderboard.js` - Leaderboard display
- `commands/fork-badges.js` - Badge display
- `lib/gamification.js` - Points and badge logic
- `jobs/monthlyWinner.js` - Monthly winner announcement

---

## 📝 Feature 6: Fork Onboarding Tracker

### Description
Track 7-step onboarding progress for new fork leads.

### Onboarding Checklist (7 Steps)

| Step | Description |
|------|-------------|
| 1 | ✅ GitHub repository joined |
| 2 | ✅ Fork channel created |
| 3 | ✅ Website deployed |
| 4 | ✅ Notion workspace shared |
| 5 | ✅ First pulse submitted |
| 6 | ✅ Team structure defined |
| 7 | ✅ First event planned |

### Commands

#### `/onboarding-status`
View onboarding progress.

**Options:**
- `city` (optional): Specific fork or all pending

**Output:** Progress bar with checklist showing completed/pending steps

#### `/onboarding-complete` (Staff Only)
Mark onboarding step complete.

**Options:**
- `city` (required): Fork city
- `step` (required): Step number (1-7)

### Auto Reminders

| Timing | Check |
|--------|-------|
| 48 hrs after merge | Check step 1 (GitHub) |
| 72 hrs after merge | Check step 3 (Website) |
| 7 days after merge | Check step 4 (Notion) |
| Weekly | Remind incomplete steps |

**Rewards:** +20 points when onboarding is complete

### Files
- `commands/onboarding-status.js` - View progress
- `commands/onboarding-complete.js` - Mark steps complete
- `lib/onboarding.js` - Onboarding logic
- `jobs/onboardingCheck.js` - Reminder job

---

## 👥 Feature 7: Team Structure Validator

### Description
Validate fork team composition and identify gaps.

### Required Roles (Minimum)

| Role | Emoji | Responsibility |
|------|-------|----------------|
| Tech Lead | 🎯 | Technical direction |
| Creative Lead | 🎨 | Design/marketing |
| Ops Lead | 📋 | Operations/logistics |

### Additional Roles
- Volunteer
- Member

### Team Validation Rules

| Rule | Description |
|------|-------------|
| Required coverage | Each required role must have at least 1 person |
| No overcrowding | No role should have more than 3 people |
| Role limit | One person cannot hold more than 2 roles |

### Commands

#### `/team-update`
Update fork team members.

**Options:**
- `city` (required): Fork city
- `member` (required): Discord user
- `role` (required): `tech-lead`, `creative-lead`, `ops-lead`, `volunteer`, or `member`
- `action` (required): `add` or `remove`

**Example Usage:**
```
/team-update city:Delhi member:@user role:tech-lead action:add
```

**Rewards:** +1 point per member added, +5 when team is complete

#### `/team-view`
View fork team structure.

**Options:**
- `city` (optional): Specific fork or all

**Output:** Visual team breakdown with validation status

### Notion Integration
Team members stored in `NOTION_TEAM_DB` with:
- Name
- Fork (relation)
- Discord ID
- Role
- Joined Date

### Files
- `commands/team-update.js` - Update team
- `commands/team-view.js` - View team
- `lib/teamValidator.js` - Validation logic

---

## 📊 Feature 8: Fork Status Dashboard

### Description
Single command to view comprehensive fork information.

### Commands

#### `/fork-status`
View complete fork status dashboard.

**Options:**
- `city` (required): Fork city

### Dashboard Output

```
━━━ FORK STATUS: {CITY} ━━━

📊 HEALTH SCORE: 78/100 (Good)

👥 TEAM STRUCTURE
├─ Tech Lead: @user ✅
├─ Creative Lead: @user ✅
└─ Ops Lead: ⚠️ MISSING

📅 EVENTS
├─ Upcoming: 2
├─ Completed: 5
└─ Next: Workshop on May 15

🤝 PARTNERSHIPS: 3
├─ Company A
├─ Company B
└─ University C

📝 LAST PULSE: 3 days ago
📋 REPORTS: 2/2 submitted this quarter

✅ ONBOARDING: 5/7 complete

🏆 BADGES: 🎯 🌟 🤝

⚠️ ALERTS:
├─ Missing Ops Lead
└─ No events planned for June
```

### Data Integration
The dashboard pulls data from:
- Health Score module
- Team Validator module
- Events system
- Reports system
- Onboarding tracker
- Gamification badges
- Smart Reminders (alerts)

### Files
- `commands/fork-status.js` - Dashboard command

---

## 🎙️ Feature 9: Meeting Scheduler & Voice Agent

### Description
Exposes a web scheduling portal (`cal.gobnb.org`) for members to book sync sessions, links bookings with Cal.com/Google Calendar, provisions temporary Discord Voice Channels, plays legal consent warnings, records the audio, transcribes it with Gemini, and delivers formatted briefs. Also includes a meeting landing/reschedule interface, contributor instant meeting launcher, Web Push notification architecture, and Discord avatar synchronization.

### Key Workflows
1. **Web Scheduler Portal (`cal.gobnb.org`):**
   - Built with raw responsive HTML/JS and Svelte-like Vanilla CSS in `public/style.css`.
   - Supports display titles, custom bios, timezone configurations, and weekly availability selectors.
   - Provides a multi-host selection system (combining schedules for multiple leads) and custom meeting durations.
   - Enforces Discord OAuth2 authentication for all guest bookings, automatically adding them to the server (via `guilds.join` scope), resolving their Discord IDs, and locking pre-filled details.
   - Implements database-backed session cookie persistence (`web_sessions` table) to withstand bot restarts, along with Express `trust proxy` configuration and dynamic secure cookie handling for Nginx reverse proxies.
   - Implements direct "⚡ Request Instant Meet" buttons triggering direct Discord DMs with interactive Accept/Decline action controls.
   - **Discord Avatar Integration:** Extracts the user's avatar image hash during OAuth authentication, saves it to `user_availability` and session tables, and displays high-quality Discord profile photos on the scheduler cards.
2. **Meeting Landing Page (`/m/{meet-code}`):**
   - Implements a Google Meet-style unique room locator (`xyz-abcd-pqr`) stored securely in Turso DB.
   - Features a custom developer-themed landing UI with:
     - Real-time details (title, host names, start time, description).
     - Active participant avatars and names.
     - Live voice channel member polling to show who is currently inside the VC.
     - Direct "Join Voice Channel" launcher linking directly to the Discord app client.
3. **Meeting Rescheduler:**
   - Adds a "Reschedule Meeting" interface directly on the meeting landing card.
   - Allows either the meeting host (`creator_id`) or the meeting booker (`booked_by`, including external guest users) to reschedule the meeting to a different slot up to a maximum limit of **3 times**.
   - Enforces slot availability checks, validates the reschedule limit, and registers the reschedule reason.
   - Triggers automated notifications to all attendees across multiple channels:
     - **Web Push Notifications:** Real-time system banners delivered to users who opted-in.
     - **Discord DMs:** Rich embeds listing the change, reason, and a direct meeting page link.
     - **SMTP Email:** Fully structured HTML emails showing the old/new times, reason, and a join CTA.
4. **Instant Meeting Launcher:**
   - Features an "⚡ Instant Meeting" provisioning section on the scheduling homepage (visible only to authenticated contributors).
   - Allows users to type a title and set the scope:
     - `Open`: Anyone on the server can join the provisioned voice channel.
     - `Invite-only`: Restricted to invited hosts and guests.
   - Automatically provisions the voice channel, DMs all invitees with an active join alert, and outputs a shareable meeting page URL.
5. **Discord Voice Provisioning:**
   - Automatically provisions a temporary VC channel under the `EVENTS` category.
   - Explicitly adds the bot client ID to channel overrides to prevent voice lockout during E2E encryption handshakes.
   - Triggers voice join callbacks that announce meeting commencement and self-starts the audio recorder.
6. **Legal Recording Consent:**
   - Plays audio warning notices (in English and Hindi) on VC join.
   - Features a safety timeout of `90_000` ms to ensure long text notices are not cut off.
   - Sends direct text notices to late joiners in the VC chat with language translation toggle buttons.
7. **Recording & Gemini Transcription:**
   - Subscribes to Opus audio streams, decodes, and records audio packets with valid header CRC checksums to prevent FFmpeg mismatches.
   - Merges separate speaker segments, uploads them to the Google File API, and utilizes `gemini-3.5-flash` to extract a speaker-labeled Hinglish/English transcript and JSON briefs.
8. **DM Briefs Delivery:**
   - Matches invitee and host emails to registered Discord profiles and registers them in database tables.
   - Formats a summary, key decisions, and action items inside a Discord Embed and DMs it directly to all attendees along with the full transcript as a `.txt` file attachment.

### Commands

#### `/meet-schedule`
View or generate booking links to schedule sync sessions.

#### `/meet-start`
Manually mark a meeting as active, DM any missing invitees, and start recording immediately.

#### `/meet-transcript`
Query the database for past sync sessions and retrieve/DM meeting notes.

### Files
- `server.js` - Schedulers API, OAuth callback, cookie persistence, instant meet handles, meeting page endpoints, push registration
- `webhookServer.js` - Cal.com instant booking webhook sync and matched attendee registry
- `public/book.html` - Three-column split view booking page, dynamic slots, smooth scroll
- `public/dashboard.html` - Member profile, bio, timezone, and relative grid availability
- `public/meet.html` - Developer-themed meeting landing page with rescheduling form, attendee avatars, live polling, and join CTA
- `public/style.css` - Global theme tokens, mobile media query rules, meeting page cards, instant launcher sections
- `public/sw.js` - Service worker handling offline caching, static assets, and background Web Push notification receipts
- `lib/voiceRecorder.js` - Discord voice connection, consent audio loops (90s limit), segments recording
- `lib/transcriptionPipeline.js` - Merge audio streams, query Gemini, clean up Google File API files
- `lib/transcriptDelivery.js` - Build summary embeds and DM attendees
- `lib/pushNotifier.js` - Web Push notifications delivery framework utilizing `web-push`
- `commands/meet-schedule.js` - Schedule command
- `commands/meet-start.js` - Start command
- `commands/meet-transcript.js` - Retrieval command

---

---

## 🔧 Configuration

### Environment Variables

```env
# Discord
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=

# Notion
NOTION_TOKEN=
NOTION_FORK_REGISTRY_DB=

# Notion Extended Databases
NOTION_TEAM_DB=          # Team members database
NOTION_EVENTS_DB=        # Events database
NOTION_REPORTS_DB=       # Reports database
NOTION_REMINDERS_DB=     # Smart reminders tracking database

# Fork Handbook
FORK_HANDBOOK_URL=https://www.notion.so/33949ed2fc33818ba073ffa2d815bf1a?v=33949ed2fc3380ccbfe2000c860aa29a&source=copy_link

# Web Push Notifications (VAPID)
VAPID_PUBLIC_KEY=        # VAPID public key
VAPID_PRIVATE_KEY=       # VAPID private key
VAPID_SUBJECT=mailto:hello@gobitsnbytes.org
```

### Required Notion Databases

1. **Fork Registry** (existing)
   - Add properties: Health Score, Points, Badges, Events Count, Partnerships Count, Onboarding Steps 1-7

2. **Team Members** (new)
   - Name, Fork (relation), Discord ID, Role, Joined Date

3. **Events** (new)
   - Event Name, Fork (relation), Date, Type, Status, Description, Expected/Actual Attendees

4. **Reports** (new)
   - Fork (relation), Type, Submitted Date, Attachment URL, Notes, Status

5. **Reminders** (new, optional)
   - For tracking sent reminders to prevent spam

---

## 📁 File Structure

```
bits-bytes-bot/
├── commands/
│   ├── archive.js (existing)
│   ├── assets.js (existing)
│   ├── event-calendar.js ✅
│   ├── event-create.js ✅
│   ├── event-status.js ✅
│   ├── event-update.js ✅
│   ├── fork-health.js ✅
│   ├── fork-request.js (existing)
│   ├── fork-status.js ✅
│   ├── forks.js (existing)
│   ├── fork-badges.js ✅
│   ├── help.js (existing)
│   ├── leaderboard.js ✅
│   ├── merge.js (existing)
│   ├── onboarding-complete.js ✅
│   ├── onboarding-status.js ✅
│   ├── pulse.js (existing)
│   ├── report-status.js ✅
│   ├── report-submit.js ✅
│   ├── team-update.js ✅
│   ├── team-view.js ✅
│   └── view-forks.js (existing)
├── events/
│   ├── guildMemberAdd.js
│   ├── interactionCreate.js
│   ├── messageCreate.js
│   ├── messageReactionAdd.js
│   ├── messageReactionRemove.js
│   └── ready.js
├── jobs/
│   ├── healthWeekly.js ✅
│   ├── monthlyWinner.js ✅
│   ├── onboardingCheck.js ✅
│   ├── reminderCheck.js ✅
│   ├── reportReminders.js ✅
│   ├── staleCheck.js (existing)
│   └── weeklyBrief.js (existing)
├── lib/
│   ├── events.js ✅
│   ├── gamification.js ✅
│   ├── healthScore.js ✅
│   ├── notion.js (extended)
│   ├── onboarding.js ✅
│   ├── pushNotifier.js ✅
│   ├── roles.js (existing)
│   ├── smartReminders.js ✅
│   └── teamValidator.js ✅
├── public/
│   ├── book.html ✅
│   ├── dashboard.html ✅
│   ├── index.html (extended)
│   ├── meet.html ✅
│   ├── style.css (extended)
│   └── sw.js ✅
├── config.js
├── index.js
└── plan.md
```

---

## 🚀 Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in values
3. Create required Notion databases
4. Run `npm install` or `pnpm install`
5. Run `node deploy-commands.js` to register slash commands
6. Run `node index.js` or `pnpm start` to start the bot

---

## 📝 Recent Bug Fixes

| Date | Bug | Fix |
|------|-----|-----|
| 2026-05-26 | UI Craft & Motion Polish | Implemented Cal.com-style inline scheduling form transitions, grid-based height animations for collapsible sections/forms, and color/typography polish |
| 2026-05-26 | Role Scoping & Dynamic Routing | Implemented dynamic fork routing, collapsible role menus, and fine-grained scoped instant meets |
| 2026-05-26 | SQLite ALTER TABLE UNIQUE bug | Splitted `ALTER TABLE ADD COLUMN meet_code TEXT UNIQUE` into ADD COLUMN + CREATE UNIQUE INDEX |
| 2026-04-29 | Report reminder overdue logic | Fixed date comparison - now checks on 1st of new month for missed reports |
| 2026-04-29 | Event description optional | Made description required per spec |
| 2026-04-29 | Missing NOTION_REMINDERS_DB | Added to .env.example |
| 2026-04-29 | Leaderboard points calculation | Added on-time bonus (+2) and late penalty (-3) |
| 2026-04-29 | Missing badges | Added "On Fire" and "Rising Star" badges |

---

*Last Updated: May 26, 2026*