const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const http = require('node:http');

const db = require('./lib/db');
const meetingsDb = require('./lib/meetingsDb');
const meetingsHelper = require('./lib/meetingsHelper');
const { getEventsChannel } = require('./lib/calcomWebhook');
const config = require('./config');
const logger = require('./lib/logger');

const PORT = parseInt(process.env.WEBHOOK_PORT || '3100', 10);
const CALCOM_SECRET = process.env.CALCOM_WEBHOOK_SECRET;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// Session store: session_id -> user details
const sessions = new Map();

// Timezone offset mapping
const OFFSETS = {
    'Asia/Kolkata': '+05:30',
    'UTC': '+00:00',
    'America/New_York': '-04:00',
    'Europe/London': '+01:00',
    'Asia/Singapore': '+08:00'
};

function startWebServer(client) {
    const app = express();

    // Middleware
    app.use(cookieParser());
    
    // Custom body parser to handle raw body for Cal.com signature verification and JSON elsewhere
    app.use((req, res, next) => {
        if (req.url === '/webhooks/calcom') {
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                req.rawBody = Buffer.concat(chunks).toString('utf8');
                next();
            });
        } else {
            express.json()(req, res, next);
        }
    });

    app.use(express.static(path.join(__dirname, 'public')));

    // Auth verification helper middleware
    function checkAuth(req, res, next) {
        const sessionId = req.cookies.session_id;
        if (sessionId && sessions.has(sessionId)) {
            req.user = sessions.get(sessionId);
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    }

    // ============================================
    // DISCORD OAUTH2 ROUTES
    // ============================================

    app.get('/login', (req, res) => {
        if (!CLIENT_ID) {
            return res.send('OAuth Error: DISCORD_CLIENT_ID is not configured in .env');
        }
        const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify+email`;
        res.redirect(discordAuthUrl);
    });

    app.get('/auth/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) {
            return res.status(400).send('OAuth Error: Missing authorization code.');
        }

        try {
            // Exchange code for token
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                }),
            });

            if (!tokenResponse.ok) {
                const errText = await tokenResponse.text();
                throw new Error(`Token exchange failed: ${errText}`);
            }

            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;

            // Fetch user profile
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch user info from Discord');
            }

            const userData = await userResponse.json();

            // Create session
            const sessionId = `session_${crypto.randomBytes(16).toString('hex')}`;
            sessions.set(sessionId, {
                id: userData.id,
                username: userData.username,
                email: userData.email || null,
            });

            // Write record or update username in user_availability table if missing
            const existingUser = await db.get(`SELECT 1 FROM user_availability WHERE discord_id = ?`, [userData.id]);
            if (!existingUser) {
                await db.run(
                    `INSERT INTO user_availability (discord_id, username, email, timezone, weekly_hours, booking_link, title, description)
                     VALUES (?, ?, ?, 'Asia/Kolkata', '{"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[],"sunday":[]}', ?, ?, '')`,
                    [userData.id, userData.username, userData.email || null, `link_${userData.username.toLowerCase().substring(0, 10)}`, userData.username]
                );
            } else {
                // Update email if it changed or was null
                await db.run(`UPDATE user_availability SET email = ? WHERE discord_id = ?`, [userData.email || null, userData.id]);
            }

            // Set cookie
            res.cookie('session_id', sessionId, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
            res.redirect('/dashboard');

        } catch (error) {
            console.error('[AUTH_ERROR]', error);
            res.status(500).send(`Authentication failed: ${error.message}`);
        }
    });

    app.get('/logout', (req, res) => {
        const sessionId = req.cookies.session_id;
        if (sessionId) {
            sessions.delete(sessionId);
        }
        res.clearCookie('session_id');
        res.redirect('/');
    });

    // ============================================
    // API ENDPOINTS
    // ============================================

    // Fetch logged in user profile
    app.get('/api/user/me', checkAuth, async (req, res) => {
        try {
            const user = await db.get(`SELECT * FROM user_availability WHERE discord_id = ?`, [req.user.id]);
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: 'Failed to retrieve profile' });
        }
    });

    // Update availability config
    app.post('/api/user/availability', checkAuth, async (req, res) => {
        const { title, booking_link, description, timezone, weekly_hours } = req.body;
        
        if (!title || !booking_link) {
            return res.status(400).json({ error: 'Title and Booking Handle are required' });
        }

        // Validate booking link format
        if (!/^[a-zA-Z0-9-_]+$/.test(booking_link)) {
            return res.status(400).json({ error: 'Invalid booking handle characters' });
        }

        try {
            // Check for uniqueness of link
            const otherUser = await db.get(
                `SELECT discord_id FROM user_availability WHERE booking_link = ? AND discord_id != ?`,
                [booking_link, req.user.id]
            );
            if (otherUser) {
                return res.status(400).json({ error: 'Booking handle is already taken by another member' });
            }

            await db.run(
                `UPDATE user_availability 
                 SET title = ?, booking_link = ?, description = ?, timezone = ?, weekly_hours = ?
                 WHERE discord_id = ?`,
                [title, booking_link, description, timezone || 'Asia/Kolkata', weekly_hours, req.user.id]
            );

            // Sync email address to email preferences table too
            if (req.user.email) {
                await meetingsDb.setUserEmail(req.user.id, req.user.email);
            }

            res.json({ success: true });
        } catch (err) {
            console.error('[API_UPDATE_ERROR]', err);
            res.status(500).json({ error: 'Database update failed' });
        }
    });

    // List all active booking profiles
    app.get('/api/users', async (req, res) => {
        try {
            const users = await db.all(`SELECT username, title, booking_link, description, timezone, weekly_hours FROM user_availability WHERE booking_link IS NOT NULL`);
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: 'Database query failed' });
        }
    });

    // Calculate free slots for a host
    app.get('/api/availability/:bookingLink', async (req, res) => {
        const { bookingLink } = req.params;
        const { date } = req.query; // format YYYY-MM-DD

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Valid date parameter YYYY-MM-DD required' });
        }

        try {
            const host = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [bookingLink]);
            if (!host) {
                return res.status(404).json({ error: 'Host not found' });
            }

            const weeklyHours = JSON.parse(host.weekly_hours || '{}');
            const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            const dailySlots = weeklyHours[dayOfWeek] || [];

            if (dailySlots.length === 0) {
                return res.json([]);
            }

            // Get host timezone offset (e.g., '+05:30')
            const offset = OFFSETS[host.timezone] || '+05:30';

            // Query active meetings for this host on this date
            const meetings = await db.all(`
                SELECT m.scheduled_time, m.end_time 
                FROM meetings m
                LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
                WHERE (m.creator_id = ? OR ma.discord_id = ?) 
                  AND m.status != 'cancelled'
            `, [host.discord_id, host.discord_id]);

            const freeSlots = [];

            // Daily availability ranges
            for (const range of dailySlots) {
                const [startH, startM] = range.start.split(':').map(Number);
                const [endH, endM] = range.end.split(':').map(Number);

                let currentMin = startH * 60 + startM;
                const endMin = endH * 60 + endM;

                while (currentMin + 30 <= endMin) {
                    const h = String(Math.floor(currentMin / 60)).padStart(2, '0');
                    const m = String(currentMin % 60).padStart(2, '0');
                    const timeStr = `${h}:${m}`;

                    // Parse this slot start time in host's timezone
                    const slotStartISO = `${date}T${timeStr}:00${offset}`;
                    const slotStartMs = Date.parse(slotStartISO);
                    const slotEndMs = slotStartMs + 30 * 60 * 1000;

                    // Filter out past slots
                    if (slotStartMs > Date.now()) {
                        // Check if slot overlaps with any existing meeting
                        const overlaps = meetings.some(meeting => {
                            const mStart = Number(meeting.scheduled_time);
                            const mEnd = meeting.end_time ? Number(meeting.end_time) : (mStart + 30 * 60 * 1000);
                            return (slotStartMs < mEnd && slotEndMs > mStart);
                        });

                        if (!overlaps) {
                            freeSlots.push(timeStr);
                        }
                    }

                    currentMin += 30; // 30 minute intervals
                }
            }

            res.json(freeSlots);

        } catch (err) {
            console.error('[AVAILABILITY_API_ERROR]', err);
            res.status(500).json({ error: 'Failed to calculate slots' });
        }
    });

    // Book a meeting slot
    app.get('/:bookingLink', async (req, res, next) => {
        const { bookingLink } = req.params;
        try {
            const host = await db.get(`SELECT 1 FROM user_availability WHERE booking_link = ?`, [bookingLink]);
            if (host) {
                res.sendFile(path.join(__dirname, 'public/book.html'));
            } else {
                next();
            }
        } catch (err) {
            next();
        }
    });

    app.post('/api/book/:bookingLink', async (req, res) => {
        const { bookingLink } = req.params;
        const { date, slot, name, email, title, description } = req.body;

        if (!date || !slot || !name || !email || !title) {
            return res.status(400).json({ error: 'All fields (date, slot, name, email, title) are required.' });
        }

        try {
            const host = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [bookingLink]);
            if (!host) {
                return res.status(404).json({ error: 'Host not found.' });
            }

            const offset = OFFSETS[host.timezone] || '+05:30';
            const slotStartISO = `${date}T${slot}:00${offset}`;
            const startTimeMs = Date.parse(slotStartISO);
            const endTimeMs = startTimeMs + 30 * 60 * 1000;

            if (startTimeMs <= Date.now()) {
                return res.status(400).json({ error: 'Cannot book a slot in the past.' });
            }

            // Check if slot is still available
            const existingMeeting = await db.get(`
                SELECT 1 FROM meetings m
                LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
                WHERE (m.creator_id = ? OR ma.discord_id = ?)
                  AND m.status != 'cancelled'
                  AND m.scheduled_time < ? 
                  AND (m.end_time > ? OR m.scheduled_time + 1800000 > ?)
            `, [host.discord_id, host.discord_id, endTimeMs, startTimeMs, startTimeMs]);

            if (existingMeeting) {
                return res.status(400).json({ error: 'This slot has already been booked.' });
            }

            // Create the meeting record
            const id = `meet_calweb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            const newMeeting = {
                id,
                title: `${host.title} <> ${name}: ${title}`,
                description: description || `Custom scheduled session via cal.gobitsnbytes.org.\nInvitee: ${name} (${email})`,
                scheduledTime: startTimeMs,
                locationType: 'discord_vc',
                locationDetails: '',
                creatorId: host.discord_id,
                status: 'scheduled',
                endTime: endTimeMs,
                externalEmails: [email.trim().toLowerCase()]
            };

            await meetingsDb.createMeeting(newMeeting);
            await meetingsDb.addAttendee(id, 'user', host.discord_id);

            // Announce to events channel if bot client is logged in
            const guild = client.guilds.cache.first();
            if (guild) {
                const eventsChannel = await getEventsChannel(guild);
                if (eventsChannel) {
                    const istTimeString = new Date(startTimeMs).toLocaleString('en-US', {
                        timeZone: 'Asia/Kolkata',
                        hour12: true,
                        hour: 'numeric',
                        minute: '2-digit',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    }) + ' IST';

                    const embed = new EmbedBuilder()
                        .setTitle(`📅 SCHEDULER // NEW_BOOKING`)
                        .setDescription(`A meeting was booked via cal.gobitsnbytes.org.`)
                        .addFields(
                            { name: '📋 TITLE', value: newMeeting.title, inline: false },
                            { name: '📅 TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(startTimeMs / 1000)}:F>)`, inline: false },
                            { name: '🌐 LOCATION', value: 'Discord Temporary Voice Channel', inline: true },
                            { name: '👥 INVITEES', value: `<@${host.discord_id}>, \`${email}\``, inline: true }
                        )
                        .setColor('#FFFFFF')
                        .setTimestamp()
                        .setFooter({ text: config.BRANDING.footerText });

                    if (description) {
                        embed.addFields({ name: '📝 DESCRIPTION', value: description, inline: false });
                    }

                    await eventsChannel.send({
                        content: `🔔 **New Portal Booking**: <@${host.discord_id}>`,
                        embeds: [embed]
                    });
                }

                // Send email invite
                const createdMeeting = await meetingsDb.getMeeting(id);
                if (createdMeeting) {
                    await meetingsHelper.sendMeetingEmails(guild, createdMeeting, 'invite');
                }
            }

            res.json({ success: true });

        } catch (err) {
            console.error('[API_BOOKING_ERROR]', err);
            res.status(500).json({ error: 'Failed to process booking.' });
        }
    });

    // ============================================
    // CAL.COM WEBHOOK (MIGRATED FROM webhookServer.js)
    // ============================================

    function verifySignature(rawBody, signature) {
        if (!CALCOM_SECRET || !signature) return false;
        const expected = crypto
            .createHmac('sha256', CALCOM_SECRET)
            .update(rawBody)
            .digest('hex');
        return crypto.timingSafeEqual(
            Buffer.from(`sha256=${expected}`, 'utf8'),
            Buffer.from(signature, 'utf8')
        );
    }

    app.post('/webhooks/calcom', async (req, res) => {
        const signature = req.headers['x-cal-signature-256'];
        
        if (!verifySignature(req.rawBody, signature)) {
            logger.warn('[WEBHOOK] Invalid signature. Rejecting.');
            return res.status(401).send('Unauthorized');
        }

        res.status(200).send('OK');

        try {
            const body = JSON.parse(req.rawBody);
            const triggerEvent = body.triggerEvent;
            const payload = body.payload;

            if (!triggerEvent || !payload) return;

            const guild = client.guilds.cache.first();
            if (!guild) return;

            // Import webhook processors
            const uid = payload.uid;
            const title = payload.title || payload.eventTitle || 'Cal.com Meeting';
            const description = payload.description || payload.eventDescription || '';
            const startTime = Date.parse(payload.startTime);
            const endTime = Date.parse(payload.endTime);
            const location = payload.location || '';
            const isDiscordVC = !location || location.toLowerCase().includes('discord');

            if (triggerEvent === 'BOOKING_CREATED') {
                const existing = await meetingsDb.findMeetingByCalcomId(uid);
                if (existing) return;

                const attendeeEmails = [];
                if (payload.organizer && payload.organizer.email) {
                    attendeeEmails.push(payload.organizer.email.toLowerCase());
                }
                if (payload.attendees && Array.isArray(payload.attendees)) {
                    for (const att of payload.attendees) {
                        if (att.email) attendeeEmails.push(att.email.toLowerCase());
                    }
                }

                const emailToUserMap = await meetingsDb.findUsersByEmails(attendeeEmails);
                const matchedDiscordIds = Object.values(emailToUserMap);
                const externalEmails = attendeeEmails.filter(email => !emailToUserMap[email]);

                let linkedMeetingId = payload.metadata ? payload.metadata.discord_meeting_id : null;
                if (linkedMeetingId) {
                    await meetingsDb.setCalcomBookingId(linkedMeetingId, uid);
                    return;
                }

                const id = `meet_cal_${uid}`;
                const locationType = isDiscordVC ? 'discord_vc' : 'external';

                const newMeeting = {
                    id,
                    title,
                    description,
                    scheduledTime: startTime,
                    locationType,
                    locationDetails: isDiscordVC ? '' : location,
                    creatorId: client.user.id,
                    status: 'scheduled',
                    calcomBookingId: uid,
                    calcomUid: uid,
                    endTime,
                    externalEmails
                };

                await meetingsDb.createMeeting(newMeeting);
                for (const dId of matchedDiscordIds) {
                    await meetingsDb.addAttendee(id, 'user', dId);
                }

                const createdMeeting = await meetingsDb.getMeeting(id);
                if (createdMeeting) {
                    await meetingsHelper.sendMeetingEmails(guild, createdMeeting, 'invite');
                }
            } else if (triggerEvent === 'BOOKING_CANCELLED') {
                const existing = await meetingsDb.findMeetingByCalcomId(uid);
                if (!existing) return;

                await meetingsDb.updateMeetingStatus(existing.id, 'cancelled');

                if (existing.temp_channel_id) {
                    const vc = guild.channels.cache.get(existing.temp_channel_id);
                    if (vc) await vc.delete('Meeting cancelled on Cal.com').catch(() => {});
                }

                await meetingsHelper.sendMeetingEmails(guild, existing, 'cancel');
            }
        } catch (err) {
            console.error('[WEBHOOK_ERROR]', err);
        }
    });

    // Boot HTTP listener
    const server = http.createServer(app);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[BOOT] Scheduler & Webhook server listening on port ${PORT}`);
        logger.boot(`Scheduler & Webhook server online on port ${PORT}`, null, false);
    });
}

module.exports = { startWebServer };
