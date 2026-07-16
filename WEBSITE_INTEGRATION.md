# 🌐 Website Dashboard Integration Guide

This guide explains how to integrate the Bits & Bytes Fork Dashboard features with an existing website while maintaining a single database (Notion) for both the Discord bot and website.

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema (Notion)](#database-schema)
3. [API Integration](#api-integration)
4. [Authentication System](#authentication-system)
5. [Features Implementation](#features-implementation)
6. [Point Allocation System](#point-allocation-system)
7. [Website-to-Bot Sync](#website-to-bot-sync)
8. [Bot-to-Website Sync](#bot-to-website-sync)

---

## 🏗️ Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│   Discord Bot   │     │    Website      │
│   (Node.js)     │     │   (Your Stack)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │    ┌─────────────┐    │
         └───►│   NOTION    │◄───┘
              │  (Database) │
              └─────────────┘
                    │
              ┌─────▼─────┐
              │ Discord   │
              │ Channels  │
              └───────────┘
```

**Key Principle:** Both the Discord bot and website read/write to the same Notion databases. This ensures real-time sync without additional infrastructure.

---

## 📊 Database Schema

### Notion Databases Required

#### 1. Forks Database
| Property Name | Type | Description |
|--------------|------|-------------|
| Name | Title | Fork name |
| City | Rich Text | Fork location |
| Status | Select | Active, Inactive, Pending |
| Discord ID | Rich Text | Server ID |
| Lead | Person | Fork lead(s) |
| Points | Number | Total points |
| Health Score | Number | Health score (0-100) |
| Level | Select | Seed, Active, High Impact, Elite |
| Created | Date | Creation date |
| Last Pulse | Date | Last pulse submission |
| Weekly Pulse | Rich Text | Pulse update link |
| Events Count | Number | Total events conducted |
| Team Size | Number | Current team size |

#### 2. Events Database
| Property Name | Type | Description |
|--------------|------|-------------|
| Name | Title | Event name |
| Fork | Relation | Related fork |
| Status | Select | Draft, Planning, Announced, Ongoing, Completed, Cancelled |
| Type | Select | Workshop, Hackathon, Meetup, etc. |
| Date | Date | Event date |
| Description | Rich Text | Event details |
| Attendees | Number | Expected/actual attendees |
| Sponsors | Rich Text | Sponsor names |
| Points | Number | Points awarded |
| Discord Message ID | Rich Text | For bot sync |
| Created By | Relation | User who created |
| Applications | Relation | Linked applications |

#### 3. Team Members Database
| Property Name | Type | Description |
|--------------|------|-------------|
| Name | Title | Member name |
| Fork | Relation | Related fork |
| Role | Select | Lead, Co-Lead, Tech, Design, etc. |
| Discord ID | Rich Text | Discord user ID |
| Email | Email | Contact email |
| Status | Select | Active, Inactive, On Leave |
| Joined Date | Date | Join date |
| Onboarding Complete | Checkbox | Onboarding status |

#### 4. Reports Database
| Property Name | Type | Description |
|--------------|------|-------------|
| Title | Title | Report title |
| Fork | Relation | Related fork |
| Type | Select | Weekly, Monthly, Event, Annual |
| Status | Select | Draft, Submitted, Reviewed |
| Date | Date | Report date |
| Content | Rich Text | Report content |
| Attachments | Files | Supporting documents |
| Points | Number | Points awarded |
| Submitted By | Relation | User who submitted |
| Late | Checkbox | Submitted after deadline |

#### 5. Users Database (Website Auth)
| Property Name | Type | Description |
|--------------|------|-------------|
| Name | Title | User name |
| Email | Email | Login email |
| Password Hash | Rich Text | Hashed password |
| Role | Select | Admin, Lead, Member |
| Fork | Relation | Associated fork |
| Discord ID | Rich Text | Discord user ID |
| Created | Date | Account creation |

---

## 🔌 API Integration

### Using the Notion SDK

The website should use the official Notion SDK to interact with the databases:

```javascript
// Example: Initialize Notion client
const { Client } = require('@notionhq/client')

const notion = new Client({
  auth: process.env.NOTION_API_KEY
})

// Database IDs from your Notion workspace
const DATABASES = {
  forks: process.env.NOTION_FORKS_DB_ID,
  events: process.env.NOTION_EVENTS_DB_ID,
  members: process.env.NOTION_MEMBERS_DB_ID,
  reports: process.env.NOTION_REPORTS_DB_ID,
  users: process.env.NOTION_USERS_DB_ID
}
```

### Key lib Files to Reference

The bot already has implementations in the `lib/` folder that the website should mirror:

| File | Purpose | Website Equivalent |
|------|---------|-------------------|
| `lib/notion.js` | Notion API wrapper | Create similar API service |
| `lib/gamification.js` | Points & levels logic | Mirror exactly |
| `lib/healthScore.js` | Health calculations | Mirror exactly |
| `lib/events.js` | Event management | Mirror functions |
| `lib/onboarding.js` | Onboarding steps | Mirror functions |

---

## 🔐 Authentication System

### Simple Auth Implementation

Since OAuth is not required, implement a simple email/password auth:

```javascript
// Example auth flow
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

// Register
async function register(email, password, name, forkId, discordId) {
  const hashedPassword = await bcrypt.hash(password, 10)
  
  // Create user in Notion
  await notion.pages.create({
    parent: { database_id: DATABASES.users },
    properties: {
      Name: { title: [{ text: { content: name } }] },
      Email: { email },
      'Password Hash': { rich_text: [{ text: { content: hashedPassword } }] },
      Role: { select: { name: 'Member' } },
      Fork: { relation: { id: forkId } },
      'Discord ID': { rich_text: [{ text: { content: discordId } }] }
    }
  })
}

// Login
async function login(email, password) {
  // Query Notion for user
  const response = await notion.databases.query({
    database_id: DATABASES.users,
    filter: { property: 'Email', email: { equals: email } }
  })
  
  const user = response.results[0]
  const valid = await bcrypt.compare(password, user.properties['Password Hash'].rich_text[0].text.content)
  
  if (!valid) throw new Error('Invalid credentials')
  
  // Generate JWT
  return jwt.sign({ 
    userId: user.id,
    role: user.properties.Role.select.name,
    forkId: user.properties.Fork.relation[0]?.id
  }, process.env.JWT_SECRET)
}
```

### Role-Based Access

| Role | Permissions |
|------|-------------|
| **Admin** | Full access to all forks, manage users, view network-wide stats |
| **Lead** | Manage own fork, events, team, submit reports |
| **Member** | View fork info, view own tasks, view events |

---

## ⚡ Features Implementation

### 1. Event Management

#### Create Event (Website)
```javascript
async function createEvent(forkId, eventData, userId) {
  // Create event in Notion
  const event = await notion.pages.create({
    parent: { database_id: DATABASES.events },
    properties: {
      Name: { title: [{ text: { content: eventData.name } }] },
      Fork: { relation: { id: forkId } },
      Status: { select: { name: 'Planning' } },
      Type: { select: { name: eventData.type } },
      Date: { date: { start: eventData.date } },
      Description: { rich_text: [{ text: { content: eventData.description } }] }
    }
  })
  
  // Award points for event creation
  await addPoints(forkId, 10, 'Event Created')
  
  // Trigger Discord notification (via webhook or shared flag)
  await notifyDiscord(forkId, 'event_created', event)
  
  return event
}
```

#### Event Pipeline Stages
1. **Draft** → Being planned, not visible to members
2. **Planning** → Details being finalized
3. **Announced** → Visible to members, accepting applications
4. **Ongoing** → Event in progress
5. **Completed** → Event finished, award full points
6. **Cancelled** → Event cancelled

### 2. Team Management

#### Add Team Member
```javascript
async function addTeamMember(forkId, memberData) {
  const member = await notion.pages.create({
    parent: { database_id: DATABASES.members },
    properties: {
      Name: { title: [{ text: { content: memberData.name } }] },
      Fork: { relation: { id: forkId } },
      Role: { select: { name: memberData.role } },
      'Discord ID': { rich_text: [{ text: { content: memberData.discordId } }] },
      Status: { select: { name: 'Active' } }
    }
  })
  
  // Update fork team size
  await updateForkTeamSize(forkId)
  
  return member
}
```

### 3. Reports

#### Submit Report
```javascript
async function submitReport(forkId, reportData, userId) {
  const isLate = checkIfLate(reportData.dueDate)
  
  const report = await notion.pages.create({
    parent: { database_id: DATABASES.reports },
    properties: {
      Title: { title: [{ text: { content: reportData.title } }] },
      Fork: { relation: { id: forkId } },
      Type: { select: { name: reportData.type } },
      Status: { select: { name: 'Submitted' } },
      Content: { rich_text: [{ text: { content: reportData.content } }] },
      Late: { checkbox: isLate }
    }
  })
  
  // Award points
  let points = 15 // Base report submission
  if (!isLate) points += 10 // On-time bonus
  if (isLate) points -= 15 // Late penalty
  
  await addPoints(forkId, points, 'Report Submitted')
  
  return report
}
```

### 4. Health Score

Use the existing `lib/healthScore.js` logic:

```javascript
// healthScore.js - Use this exact logic in your website
function calculateHealthScore(fork) {
  const breakdown = {
    pulseRecency: calculatePulseScore(fork),
    eventsConducted: calculateEventsScore(fork),
    teamCompleteness: calculateTeamScore(fork),
    reportSubmission: calculateReportScore(fork),
    partnerships: calculatePartnershipScore(fork)
  }
  
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score: total, breakdown }
}

function getHealthStatus(score) {
  if (score >= 80) return { status: 'Excellent', color: 'green' }
  if (score >= 60) return { status: 'Good', color: 'yellow' }
  if (score >= 40) return { status: 'Fair', color: 'orange' }
  return { status: 'At Risk', color: 'red' }
}
```

### 5. Checklist Tracking

#### Onboarding Checklist
Create a separate database or use checkboxes in Notion:

```javascript
const ONBOARDING_STEPS = [
  { id: 'discord', label: 'Join Discord Server', points: 5 },
  { id: 'intro', label: 'Post Introduction', points: 5 },
  { id: 'role', label: 'Select Role', points: 5 },
  { id: 'handbook', label: 'Read Fork Handbook', points: 10 },
  { id: 'first_event', label: 'Attend First Event', points: 15 }
]

async function completeOnboardingStep(memberId, stepId) {
  // Update member's onboarding progress
  await notion.pages.update({
    page_id: memberId,
    properties: {
      [`Onboarding_${stepId}`]: { checkbox: true }
    }
  })
  
  // Award points
  const step = ONBOARDING_STEPS.find(s => s.id === stepId)
  await addPointsToMember(memberId, step.points)
}
```

---

## 🎮 Point Allocation System

### Points Reference (Updated)

```javascript
const POINTS = {
  // Events
  EVENT_CREATED: 10,
  EVENT_APPROVED: 20,
  EVENT_COMPLETED: 50,
  PER_SPONSOR_SECURED: 10,
  
  // Engagement
  REPORT_SUBMITTED: 15,
  WEEKLY_PULSE_UPDATE: 10,
  ON_TIME_REPORT_BONUS: 10,
  
  // Penalties
  MISSED_REPORT_DEADLINE: -15,
  INACTIVE_TWO_WEEKS: -25
}

async function addPoints(forkId, points, reason) {
  // Get current points
  const fork = await notion.pages.retrieve({ page_id: forkId })
  const currentPoints = fork.properties.Points.number || 0
  
  // Update points
  await notion.pages.update({
    page_id: forkId,
    properties: {
      Points: { number: currentPoints + points }
    }
  })
  
  // Update level based on new points
  const newLevel = getLevelFromPoints(currentPoints + points)
  await notion.pages.update({
    page_id: forkId,
    properties: {
      Level: { select: { name: newLevel } }
    }
  })
  
  // Log for audit
  console.log(`Fork ${forkId}: ${points > 0 ? '+' : ''}${points} points - ${reason}`)
}
```

### Level System (Updated)

```javascript
function getLevelFromPoints(points) {
  if (points >= 700) return 'Elite Fork'
  if (points >= 300) return 'High Impact Fork'
  if (points >= 100) return 'Active Fork'
  return 'Seed Fork'
}

const LEVELS = {
  'Seed Fork': { min: 0, max: 99, badge: '🌱', color: '#81ECEC' },
  'Active Fork': { min: 100, max: 299, badge: '🌿', color: '#00FF95' },
  'High Impact Fork': { min: 300, max: 699, badge: '🌳', color: '#00F2FF' },
  'Elite Fork': { min: 700, max: Infinity, badge: '🏆', color: '#FFD700' }
}
```

---

## 🔄 Website-to-Bot Sync

### Method 1: Webhook Notifications

When website creates/updates data, send a webhook to the bot:

```javascript
// Website side
async function notifyBot(action, data) {
  await fetch(process.env.BOT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data, timestamp: Date.now() })
  })
}

// Bot side (add to index.js)
const express = require('express')
const app = express()

app.post('/webhook', async (req, res) => {
  const { action, data } = req.body
  
  switch (action) {
    case 'event_created':
      await announceEventInDiscord(data)
      break
    case 'report_submitted':
      await notifyReportSubmission(data)
      break
    // ... other actions
  }
  
  res.json({ success: true })
})
```

### Method 2: Shared Notion Fields

Use a "Sync Status" field that both bot and website can check:

```javascript
// When website creates an event
await notion.pages.create({
  properties: {
    // ... other properties
    'Sync to Discord': { checkbox: true },
    'Discord Message ID': { rich_text: [] } // Empty, bot will fill
  }
})

// Bot periodically checks for unsynced items
async function syncFromNotion() {
  const unsynced = await notion.databases.query({
    database_id: DATABASES.events,
    filter: {
      and: [
        { property: 'Sync to Discord', checkbox: { equals: true } },
        { property: 'Discord Message ID', rich_text: { is_empty: true } }
      ]
    }
  })
  
  for (const event of unsynced.results) {
    const messageId = await postToDiscord(event)
    await notion.pages.update({
      page_id: event.id,
      properties: {
        'Sync to Discord': { checkbox: false },
        'Discord Message ID': { rich_text: [{ text: { content: messageId } }] }
      }
    })
  }
}
```

---

## 🤖 Bot-to-Website Sync

Since both read from Notion, the website automatically sees bot changes. However, you may want real-time updates:

### Option 1: Polling

```javascript
// Website polls Notion every minute
setInterval(async () => {
  const latestEvents = await fetchRecentEvents()
  updateUI(latestEvents)
}, 60000)
```

### Option 2: Notion Webhooks (if available)

Notion doesn't have native webhooks, but you can use:
- Notion Automations (limited)
- Third-party tools like Zapier or Make

### Option 3: WebSocket from Bot

```javascript
// Bot sends real-time updates to website
const WebSocket = require('ws')
const wss = new WebSocket.Server({ port: 8080 })

// When bot updates something
function broadcastToWebsite(type, data) {
  wss.clients.forEach(client => {
    client.send(JSON.stringify({ type, data }))
  })
}
```

---

## 📁 File Structure Reference

Your website should mirror the bot's lib structure:

```
website/
├── src/
│   ├── lib/
│   │   ├── notion.js        # Notion API wrapper
│   │   ├── gamification.js  # Points & levels (copy from bot)
│   │   ├── healthScore.js   # Health calculations (copy from bot)
│   │   ├── events.js        # Event management
│   │   └── onboarding.js    # Onboarding steps
│   ├── routes/
│   │   ├── auth.js          # Login/register
│   │   ├── forks.js         # Fork CRUD
│   │   ├── events.js        # Event CRUD
│   │   ├── team.js          # Team management
│   │   ├── reports.js       # Report submission
│   │   └── health.js        # Health scores
│   └── middleware/
│       └── auth.js          # JWT verification
└── .env
    NOTION_API_KEY=secret_
    NOTION_FORKS_DB_ID=xxx
    NOTION_EVENTS_DB_ID=xxx
    NOTION_MEMBERS_DB_ID=xxx
    NOTION_REPORTS_DB_ID=xxx
    NOTION_USERS_DB_ID=xxx
    JWT_SECRET=xxx
    BOT_WEBHOOK_URL=xxx
```

---

## ✅ Implementation Checklist

### Phase 1: Core Setup
- [ ] Create Notion databases with correct schema
- [ ] Set up Notion API integration
- [ ] Implement authentication (register/login)
- [ ] Create role-based access middleware

### Phase 2: Features
- [ ] Fork dashboard (view fork info, stats)
- [ ] Event management (create, edit, pipeline view)
- [ ] Team management (add/remove members, roles)
- [ ] Reports (submit, view history, attachments)
- [ ] Health score display

### Phase 3: Sync
- [ ] Website → Discord notifications
- [ ] Handle website-created events in bot
- [ ] Real-time updates between platforms

### Phase 4: Gamification
- [ ] Implement updated point allocation
- [ ] Add level badges display
- [ ] Create leaderboard view
- [ ] Penalty system for missed deadlines

---

## 🔗 Quick Reference: Bot Commands → Website Features

| Bot Command | Website Equivalent |
|-------------|-------------------|
| `/event-create` | Event creation form |
| `/event-status` | Event pipeline view |
| `/event-calendar` | Calendar component |
| `/team-view` | Team members list |
| `/team-update` | Edit member modal |
| `/report-submit` | Report submission form |
| `/report-status` | Reports list |
| `/fork-health` | Health score card |
| `/fork-badges` | Level badge display |
| `/leaderboard` | Network leaderboard |
| `/onboarding-status` | Onboarding checklist |
| `/pulse` | Pulse update form |

---

## 📞 Support

For questions about the bot's implementation, refer to:
- `lib/gamification.js` - Points and levels
- `lib/healthScore.js` - Health calculations
- `lib/notion.js` - Notion API patterns
- `lib/events.js` - Event management
- Commands in `/commands` folder for Discord-specific logic