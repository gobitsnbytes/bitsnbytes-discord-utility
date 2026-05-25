const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const http = require('node:http');
const { EmbedBuilder } = require('discord.js');

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
        const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const host = req.get('host');
        let redirectUri = process.env.REDIRECT_URI;
        if (!redirectUri || !redirectUri.includes(host)) {
            redirectUri = `${protocol}://${host}/auth/callback`;
        }

        const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify+email`;
        res.redirect(discordAuthUrl);
    });

    app.get('/auth/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) {
            return res.status(400).send('OAuth Error: Missing authorization code.');
        }

        try {
            const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
            const host = req.get('host');
            let redirectUri = process.env.REDIRECT_URI;
            if (!redirectUri || !redirectUri.includes(host)) {
                redirectUri = `${protocol}://${host}/auth/callback`;
            }

            // Exchange code for token
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
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

            // Resolve Discord city role
            let cityRoleName = null;
            let cityRoleId = null;
            try {
                const guildId = process.env.GUILD_ID;
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    await guild.members.fetch().catch(() => {});
                    const member = guild.members.cache.get(userData.id);
                    if (member) {
                        const notion = require('./lib/notion');
                        const forks = await notion.getForks().catch(() => []);
                        const activeCities = forks
                            .filter(f => f.properties?.Status?.select?.name === 'Active')
                            .map(f => notion.getCityName(f))
                            .filter(Boolean);

                        const foundCityRole = member.roles.cache.find(r => 
                            activeCities.some(city => city.toLowerCase() === r.name.toLowerCase())
                        );

                        if (foundCityRole) {
                            cityRoleName = foundCityRole.name;
                            cityRoleId = foundCityRole.id;
                        }
                    }
                }
            } catch (roleErr) {
                console.warn('[AUTH_CALLBACK] Failed to resolve member city role:', roleErr.message);
            }

            let defaultTitle = userData.username;
            if (cityRoleName) {
                defaultTitle = `Fork ${cityRoleName}`;
            }

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
                    `INSERT INTO user_availability (discord_id, username, email, timezone, weekly_hours, booking_link, title, description, associated_role_id)
                     VALUES (?, ?, ?, 'Asia/Kolkata', '{"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[],"sunday":[]}', ?, ?, '', ?)`,
                    [userData.id, userData.username, userData.email || null, `link_${userData.username.toLowerCase().substring(0, 10)}`, defaultTitle, cityRoleId || null]
                );
            } else {
                // Update email and associated_role_id if it changed
                await db.run(
                    `UPDATE user_availability 
                     SET email = ?, associated_role_id = ? 
                     WHERE discord_id = ?`,
                    [userData.email || null, cityRoleId || null, userData.id]
                );
            }

            // Set cookie
            res.cookie('session_id', sessionId, { 
                httpOnly: true, 
                secure: process.env.NODE_ENV === 'production',
                path: '/'
            });
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
        res.clearCookie('session_id', { path: '/' });
        res.redirect('/');
    });

    app.get('/dashboard', (req, res) => {
        const sessionId = req.cookies.session_id;
        if (sessionId && sessions.has(sessionId)) {
            res.sendFile(path.join(__dirname, 'public/dashboard.html'));
        } else {
            res.redirect('/');
        }
    });

    // ============================================
    // API ENDPOINTS
    // ============================================

    // Fetch logged in user profile
    app.get('/api/user/me', checkAuth, async (req, res) => {
        try {
            const user = await db.get(`SELECT * FROM user_availability WHERE discord_id = ?`, [req.user.id]);
            if (user && user.associated_role_id) {
                const guildId = process.env.GUILD_ID;
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    const role = guild.roles.cache.get(user.associated_role_id);
                    if (role) {
                        user.associated_role_name = role.name;
                    }
                }
            }
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: 'Failed to retrieve profile' });
        }
    });

    // Update availability config
    app.post('/api/user/availability', checkAuth, async (req, res) => {
        const { title, booking_link, description, timezone, weekly_hours, calcom_event_type_id } = req.body;
        
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
                 SET title = ?, booking_link = ?, description = ?, timezone = ?, weekly_hours = ?, calcom_event_type_id = ?
                 WHERE discord_id = ?`,
                [title, booking_link, description, timezone || 'Asia/Kolkata', weekly_hours, calcom_event_type_id || null, req.user.id]
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

    // Fetch available event types from Cal.com
    app.get('/api/calcom/event-types', checkAuth, async (req, res) => {
        try {
            const calcom = require('./lib/calcom');
            const eventTypes = await calcom.getEventTypes();
            res.json(eventTypes);
        } catch (err) {
            console.error('[CALCOM_API_ERROR]', err);
            res.status(500).json({ error: 'Failed to retrieve event types' });
        }
    });

    // List all active booking profiles
    app.get('/api/users', async (req, res) => {
        try {
            const users = await db.all(`SELECT username, title, booking_link, description, timezone, weekly_hours, calcom_event_type_id, associated_role_id FROM user_availability WHERE booking_link IS NOT NULL`);
            res.json(users);
        } catch (err) {
            res.status(500).json({ error: 'Database query failed' });
        }
    });

    // Helper to calculate free slots in UTC for a single host
    async function getHostFreeSlotsUTC(host, dateStr, duration, primaryTimeZone) {
        const offset = OFFSETS[primaryTimeZone] || '+05:30';
        const localStartISO = `${dateStr}T00:00:00${offset}`;
        const localEndISO = `${dateStr}T23:59:59${offset}`;
        const startUTC = new Date(localStartISO).toISOString();
        const endUTC = new Date(localEndISO).toISOString();

        if (host.calcom_event_type_id && process.env.CALCOM_API_KEY) {
            try {
                const calcom = require('./lib/calcom');
                const slotsData = await calcom.getSlots(host.calcom_event_type_id, startUTC, endUTC, duration);
                const slotsMap = slotsData.slots || slotsData;
                const utcSlots = [];

                let slotsArray = [];
                if (Array.isArray(slotsMap)) {
                    slotsArray = slotsMap;
                } else if (slotsMap && typeof slotsMap === 'object') {
                    for (const dKey in slotsMap) {
                        if (Array.isArray(slotsMap[dKey])) {
                            slotsArray.push(...slotsMap[dKey]);
                        }
                    }
                }

                for (const s of slotsArray) {
                    if (s.time || s.start) {
                        utcSlots.push(new Date(s.time || s.start).toISOString());
                    }
                }
                return utcSlots;
            } catch (calcomErr) {
                console.error(`[CALCOM] Slots fetch failed for host ${host.username}:`, calcomErr.message);
            }
        }

        // Local DB calculation
        const hostOffset = OFFSETS[host.timezone] || '+05:30';
        const weeklyHours = JSON.parse(host.weekly_hours || '{}');
        
        // We get the meetings for this host
        const meetings = await db.all(`
            SELECT m.scheduled_time, m.end_time 
            FROM meetings m
            LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
            WHERE (m.creator_id = ? OR ma.discord_id = ?) 
              AND m.status != 'cancelled'
        `, [host.discord_id, host.discord_id]);

        const utcSlots = [];
        const primaryDateObj = new Date(localStartISO);
        const checkDates = [
            new Date(primaryDateObj.getTime() - 24 * 60 * 60 * 1000), // yesterday
            primaryDateObj, // today
            new Date(primaryDateObj.getTime() + 24 * 60 * 60 * 1000)  // tomorrow
        ];

        for (const dObj of checkDates) {
            const dStr = dObj.toISOString().split('T')[0];
            const dayOfWeekName = dObj.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            const dailySlots = weeklyHours[dayOfWeekName] || [];

            for (const range of dailySlots) {
                const [startH, startM] = range.start.split(':').map(Number);
                const [endH, endM] = range.end.split(':').map(Number);

                let currentMin = startH * 60 + startM;
                const endMin = endH * 60 + endM;

                while (currentMin + duration <= endMin) {
                    const h = String(Math.floor(currentMin / 60)).padStart(2, '0');
                    const m = String(currentMin % 60).padStart(2, '0');
                    const timeStr = `${h}:${m}`;

                    // Calculate slot start time in host's timezone
                    const slotStartISO = `${dStr}T${timeStr}:00${hostOffset}`;
                    const slotStartMs = Date.parse(slotStartISO);
                    const slotEndMs = slotStartMs + duration * 60 * 1000;

                    // Check if this slot falls within our primary host's date range (startUTC to endUTC)
                    if (slotStartMs >= Date.parse(startUTC) && slotStartMs <= Date.parse(endUTC) && slotStartMs > Date.now()) {
                        // Check overlap
                        const overlaps = meetings.some(m => {
                            const mStart = Number(m.scheduled_time);
                            const mEnd = m.end_time ? Number(m.end_time) : (mStart + 30 * 60 * 1000);
                            return (slotStartMs < mEnd && slotEndMs > mStart);
                        });

                        if (!overlaps) {
                            utcSlots.push(new Date(slotStartMs).toISOString());
                        }
                    }

                    currentMin += 15; // 15-minute increments for start times
                }
            }
        }

        return utcSlots;
    }

    // Calculate free slots for a host
    app.get('/api/availability/:bookingLink', async (req, res) => {
        const { bookingLink } = req.params;
        const { date } = req.query; // format YYYY-MM-DD
        const duration = parseInt(req.query.duration || 30, 10);
        const additionalHosts = req.query.additional ? req.query.additional.split(',') : [];

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Valid date parameter YYYY-MM-DD required' });
        }

        try {
            const primaryHost = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [bookingLink]);
            if (!primaryHost) {
                return res.status(404).json({ error: 'Primary host not found' });
            }

            // Fetch primary host slots
            let commonSlots = await getHostFreeSlotsUTC(primaryHost, date, duration, primaryHost.timezone);

            // Fetch and intersect additional host slots
            for (const handle of additionalHosts) {
                if (!handle.trim()) continue;
                const addHost = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [handle.trim()]);
                if (addHost) {
                    const hostSlots = await getHostFreeSlotsUTC(addHost, date, duration, primaryHost.timezone);
                    // Intersect
                    commonSlots = commonSlots.filter(slot => hostSlots.includes(slot));
                }
            }

            // Convert common UTC slots back to primary host's timezone time strings (HH:MM)
            const resultSlots = [];
            for (const utcTime of commonSlots) {
                const dateObj = new Date(utcTime);
                const localTimeStr = dateObj.toLocaleTimeString('en-US', {
                    timeZone: primaryHost.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                const parts = localTimeStr.split(':');
                if (parts.length >= 2) {
                    const formatted = `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
                    if (!resultSlots.includes(formatted)) {
                        resultSlots.push(formatted);
                    }
                }
            }

            resultSlots.sort();
            res.json(resultSlots);

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
        const { date, slot, name, email, title, description, notes, duration, additionalHosts, inviteWholeFork } = req.body;

        if (!date || !slot || !name || !email || !title) {
            return res.status(400).json({ error: 'All fields (date, slot, name, email, title) are required.' });
        }

        const selectedDuration = parseInt(duration || 30, 10);

        try {
            const primaryHost = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [bookingLink]);
            if (!primaryHost) {
                return res.status(404).json({ error: 'Primary host not found.' });
            }

            const offset = OFFSETS[primaryHost.timezone] || '+05:30';
            const slotStartISO = `${date}T${slot}:00${offset}`;
            const startTimeMs = Date.parse(slotStartISO);
            const endTimeMs = startTimeMs + selectedDuration * 60 * 1000;

            if (startTimeMs <= Date.now()) {
                return res.status(400).json({ error: 'Cannot book a slot in the past.' });
            }

            // Resolve all hosts (primary and additional)
            const allHosts = [primaryHost];
            const additionalHandles = Array.isArray(additionalHosts) ? additionalHosts : (additionalHosts ? additionalHosts.split(',') : []);
            
            for (const handle of additionalHandles) {
                if (!handle.trim() || handle.trim() === bookingLink) continue;
                const addHost = await db.get(`SELECT * FROM user_availability WHERE booking_link = ?`, [handle.trim()]);
                if (addHost) {
                    allHosts.push(addHost);
                }
            }

            // Check if slot is still available for ALL hosts
            for (const host of allHosts) {
                const existingMeeting = await db.get(`
                    SELECT 1 FROM meetings m
                    LEFT JOIN meeting_attendees ma ON m.id = ma.meeting_id
                    WHERE (m.creator_id = ? OR ma.discord_id = ?)
                      AND m.status != 'cancelled'
                      AND m.scheduled_time < ? 
                      AND (COALESCE(m.end_time, m.scheduled_time + 1800000) > ?)
                `, [host.discord_id, host.discord_id, endTimeMs, startTimeMs]);

                if (existingMeeting) {
                    return res.status(400).json({ error: `The slot is no longer available for ${host.title || host.username}.` });
                }
            }

            // Create the meeting record
            const id = `meet_calweb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            // Push booking to Cal.com for the primary host if configured
            let calcomBookingId = null;
            if (primaryHost.calcom_event_type_id && process.env.CALCOM_API_KEY) {
                try {
                    const calcom = require('./lib/calcom');
                    const bookingBody = {
                        eventTypeId: parseInt(primaryHost.calcom_event_type_id, 10),
                        start: new Date(startTimeMs).toISOString(),
                        end: new Date(endTimeMs).toISOString(),
                        timeZone: primaryHost.timezone || 'Asia/Kolkata',
                        language: 'en',
                        metadata: {
                            discord_meeting_id: id
                        },
                        attendee: {
                            name: name,
                            email: email.trim().toLowerCase(),
                            timeZone: primaryHost.timezone || 'Asia/Kolkata'
                        },
                        bookingFieldsResponses: {
                            notes: notes || description || ''
                        }
                    };
                    const bookingResponse = await calcom.createBooking(bookingBody);
                    if (bookingResponse && (bookingResponse.uid || bookingResponse.id)) {
                        calcomBookingId = String(bookingResponse.uid || bookingResponse.id);
                    }
                } catch (calcomErr) {
                    console.warn('[CALCOM] Web booking sync failed:', calcomErr.message);
                }
            }

            let finalDescription = description || `Custom scheduled session via cal.gobitsnbytes.org.\nInvitee: ${name} (${email})`;
            if (notes) {
                finalDescription += `\n\nNotes from booker:\n${notes}`;
            }

            // List of host names for meeting title
            const hostTitles = allHosts.map(h => h.title || h.username).join(', ');

            const newMeeting = {
                id,
                title: `${hostTitles} <> ${name}: ${title}`,
                description: finalDescription,
                scheduledTime: startTimeMs,
                locationType: 'discord_vc',
                locationDetails: '',
                creatorId: primaryHost.discord_id,
                status: 'scheduled',
                endTime: endTimeMs,
                externalEmails: [email.trim().toLowerCase()],
                calcomBookingId,
                calcomUid: calcomBookingId
            };

            await meetingsDb.createMeeting(newMeeting);
            
            // Add all hosts as attendees
            for (const host of allHosts) {
                await meetingsDb.addAttendee(id, 'user', host.discord_id);
            }

            // Invite the whole fork if requested and host has role mapping
            for (const host of allHosts) {
                if (inviteWholeFork && host.associated_role_id) {
                    await meetingsDb.addAttendee(id, 'role', host.associated_role_id);
                }
            }

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

                    // Construct host mentions
                    const hostMentions = allHosts.map(h => `<@${h.discord_id}>`).join(', ');

                    const embed = new EmbedBuilder()
                        .setTitle(`📅 SCHEDULER // NEW_BOOKING`)
                        .setDescription(`A meeting was booked via cal.gobitsnbytes.org.`)
                        .addFields(
                            { name: '📋 TITLE', value: newMeeting.title, inline: false },
                            { name: '📅 TIME (IST)', value: `\`${istTimeString}\` (<t:${Math.floor(startTimeMs / 1000)}:F>)`, inline: false },
                            { name: '🌐 LOCATION', value: 'Discord Temporary Voice Channel', inline: true },
                            { name: '👥 HOSTS', value: hostMentions, inline: true },
                            { name: '✉️ BOOKER', value: `\`${name} (${email})\``, inline: true }
                        )
                        .setColor('#FFFFFF')
                        .setTimestamp()
                        .setFooter({ text: config.BRANDING.footerText });

                    if (finalDescription) {
                        embed.addFields({ name: '📝 DESCRIPTION', value: finalDescription, inline: false });
                    }

                    const leadMentions = allHosts.map(h => `<@${h.discord_id}>`).join(' ');
                    await eventsChannel.send({
                        content: `🔔 **New Portal Booking**: ${leadMentions}`,
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
