[ID: 36b49ed2-fc33-81e5-acae-c3e905f0c918] > 💡 This guide outlines the features, commands, and workflows of the Bits&Bytes Discord Bot. The bot bridges active communications inside Discord with our Notion databases and SQLite tables to automate chapter operations, event tracking, meeting transcription, and gamification.
[ID: 36b49ed2-fc33-81a1-a3bf-fb3b34f18e8a] 
# 👥 User Perspectives & Workflows
[ID: 36b49ed2-fc33-8186-a51c-ce84bd0fcfb5] The bot features two distinct operational workflows depending on whether you are a Fork Lead managing a local chapter or an Upstream Team member overseeing the network.
[ID: 36b49ed2-fc33-8180-8cb4-c0b171362922] 
## 1. Fork Leads' POV (Local Chapters)
[ID: 36b49ed2-fc33-81ef-8197-ed801a7571cd] > 🎯 As a Fork Lead, your interactions with the bot keep the network synchronized. You are responsible for keeping your team active, reporting events, maintaining your pulse, and utilizing the meeting scheduler.
[ID: 36b49ed2-fc33-8168-9b5f-f6fb78b4fd04] * /pulse: Submit regular weekly pulses to log chapter activity. Keeps your chapter status Active and registers local updates in Notion.
[ID: 36b49ed2-fc33-8176-aa71-ea16f605902f] * /team-update: Add or remove members from your local SQLite database chapter, and assign core roles (Tech Lead, Creative Lead, Ops Lead).
[ID: 36b49ed2-fc33-81d2-bdbf-d540a435e0ec] * /team-view: View your current team structure and roles directly inside Discord.
[ID: 36b49ed2-fc33-81db-9644-d1319b1108a5] * /event-create: Propose and register new events, setting date, type, description, and expected headcount.
[ID: 36b49ed2-fc33-81c8-9409-ef18200c8ed2] * /event-update: Update event details, log final attendance figures, or adjust event lifecycle states.
[ID: 36b49ed2-fc33-8169-8cb4-f98c83f2e7f9] * /event-status: View your upcoming chapter-specific events pipeline.
[ID: 36b49ed2-fc33-8104-91b5-fca0f69bf879] * /event-calendar: Browse the entire network's upcoming events and activities.
[ID: 36b49ed2-fc33-811f-bbf7-c2c087a28fa8] * /report-submit: Submit bi-weekly or monthly accountability files (with attachments/links) to core staff.
[ID: 36b49ed2-fc33-81d7-b127-de1c469ad171] * /report-status: View outstanding or submitted reports and verify deadlines.
[ID: 36b49ed2-fc33-81fd-aceb-ffe6e8ab1e17] * /meet-email: Register your email address to receive meeting invites and .ics calendar attachments.
[ID: 36b49ed2-fc33-81f8-b4b7-ecad649c6168] * /meet-schedule: Coordinate syncs, provision temporary voice channels, and sync with Cal.com.
[ID: 36b49ed2-fc33-814a-8c04-f50e2fd8c97e] * /meet-transcript: Retrieve AI-synthesized summaries, transcripts, and action items of past voice channel syncs.
[ID: 36b49ed2-fc33-81d6-9d79-d7c72b8226e8] * /fork-status: View a complete live dashboard showing your chapter's health metrics and completeness.
[ID: 36b49ed2-fc33-8127-9778-cde8a3b0e012] * /fork-health: Check the health score leaderboard comparing all active chapters.
[ID: 36b49ed2-fc33-81c3-a0c5-df0c33074fb1] * /fork-badges: View badges and accomplishments achieved by your chapter.
[ID: 36b49ed2-fc33-81ff-b92c-c102147e3136] * /leaderboard: Check the leaderboard to see how your chapter compares in gamification points.
[ID: 36b49ed2-fc33-81ab-a50d-f1a58ea3e708] 
## 2. Upstream Team's POV (Core Staff & Admins)
[ID: 36b49ed2-fc33-8188-add8-d8234e99fd41] > 🛡️ As a Staff Member or Core Admin, the bot acts as your control panel to monitor chapter health, review new fork applications, and run system health checks.
[ID: 36b49ed2-fc33-8108-868c-ffd9f8eaec2d] * /admin-add-lead: Onboard a fork lead directly, bypassing the traditional request pipeline.
[ID: 36b49ed2-fc33-8173-8d2e-da73eab253df] * /merge: Officially merge a pending fork lead and approve their chapter.
[ID: 36b49ed2-fc33-8105-a464-f6114e781126] * /onboarding-complete: Mark a specific onboarding checklist step complete.
[ID: 36b49ed2-fc33-81d3-a271-c9774658d72b] * /onboarding-status: Check onboarding checkpoints for pending/active chapters.
[ID: 36b49ed2-fc33-8186-baab-eb756acbd6ea] * /archive: Lock and archive inactive or non-responsive chapters with a specified reason.
[ID: 36b49ed2-fc33-813d-a202-ee8258d8bc7d] * /forks: View technical topology and connections of all nodes.
[ID: 36b49ed2-fc33-818f-8973-e1e64b402888] * /forks-info: Post or update a single embed listing all active and pending forks info.
[ID: 36b49ed2-fc33-81d0-8861-c860b3595413] * /report-status: View outstanding reports status for all nodes.
[ID: 36b49ed2-fc33-8156-9bd5-c58fa050fb8e] * /meet-transcript delete: Purge an outdated or sensitive meeting transcript.
[ID: 36b49ed2-fc33-81f1-99a8-d5823d38fa1e] * /ping & /system-test: Perform latency tests and test SMTP email dispatch.
[ID: 36b49ed2-fc33-81f0-81fb-f8ee2e77b981] 
# ⚡ Core Feature Deep Dives
[ID: 36b49ed2-fc33-81d1-8380-f8e5eddd9125] 
## 📅 Meeting Scheduler & AI Transcriber ("Meet" Family)
[ID: 36b49ed2-fc33-8103-9495-c8c21878aeb7] The meeting system is a powerful integration combining Discord Voice Channels, email invitations (.ics calendar attachments), Cal.com sync, and AI recording:
[ID: 36b49ed2-fc33-81c6-ae46-c76546c43888] 1. Email Configuration: Users must run /meet-email set email:<address> to register. Without this, you will not receive invitations or calendar files.
[ID: 36b49ed2-fc33-8158-87e7-f818a7505ab8] 1. Scheduling: Run /meet-schedule to book a sync. You can schedule future meetings (IST timezone) or start one instantly (instant: True). You can invite individual users (user-invite), entire roles (role-invite), add external guest emails (external-emails comma-separated), and specify duration.
[ID: 36b49ed2-fc33-814b-ae3d-d3080c0f7439] 1. Auto-VC and Recording: For Discord location-type, the bot creates a temporary voice channel in the EVENTS category 5 minutes before start (or instantly) and pings invitees via DM. It automatically starts audio recording.
[ID: 36b49ed2-fc33-812b-8cec-cfdc03df94c1] 1. External Sync: The bot automatically syncs scheduled meetings with Cal.com (if API keys are active).
[ID: 36b49ed2-fc33-816c-8316-c52869b479f2] 1. AI Transcript: After a recorded meeting ends, the bot processes the audio, saving an AI-generated meeting summary, key decisions, action items (with assignees), and the full timestamped transcript. Access it via /meet-transcript view meeting-id:<id>. Use /meet-transcript list or /meet-transcript search query:<term> to find past transcripts.
[ID: 36b49ed2-fc33-81ac-806f-c4b904fc283c] 
## 🌱 Fork Onboarding & Lifecycle Rules
[ID: 36b49ed2-fc33-8188-8ca1-e21c9866e487] * Onboarding Journey: Complete 7 structural steps: 1. Join GitHub -> 2. Create fork channel -> 3. Deploy website -> 4. Share Notion -> 5. First pulse -> 6. Define team -> 7. Plan first event. Completed milestones are tracked via /onboarding-status.
[ID: 36b49ed2-fc33-8136-ae2e-e751e3ea9ba1] * Stale Detection: The bot runs a weekly stale detector. If a chapter has no /pulse update for 60-89 days, the lead is warned in #leads-council. At 90+ days without a pulse, an alert goes to staff in #team-forks for archiving.
[ID: 36b49ed2-fc33-8155-8aa3-e7dc48a4bd0d] * Health Score: Calculated dynamically (0-100) based on pulse consistency, events count, reports, and team completeness.
[ID: 36b49ed2-fc33-81c3-a646-fc429da47203] * Points & Badges: Earned by executing activities. View ranks via /leaderboard and badges via /fork-badges.
[ID: 36b49ed2-fc33-8161-acc2-fe60ae04d241] 
# 📋 Commands Reference Dictionary
[ID: 36b49ed2-fc33-81e5-b917-d1b868f1d549] 👤 Fork Leads Commands
[ID: 36b49ed2-fc33-8107-accf-d7f1a665aebd] 🛡️ Staff & Admin Commands
[ID: 36b49ed2-fc33-81c2-a415-e64de8e95d50] 🌐 Public & Utility Commands
[ID: 36b49ed2-fc33-80cd-a7fa-c7aa5fb970b4] 
