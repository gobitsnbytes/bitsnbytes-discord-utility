const meetingsDb = require('../lib/meetingsDb');
const { execute } = require('../commands/meet-schedule');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

// Mock config
jest.mock('../config', () => ({
	COLORS: {
		primary: '#00F2FF',
		success: '#00FF95',
		warning: '#FFCC00',
		error: '#FF0055',
	},
	EMOJIS: {
		calendar: '📆',
		reminder: '🔔',
		error: '❌',
	},
	BRANDING: {
		footerText: 'TEST_FOOTER',
	},
	PRIVACY: {
		'meet-schedule': true
	}
}));

describe('Meeting Scheduler Database Tests', () => {
	const testMeetingId = 'meet_test_123';

	beforeAll(async () => {
		await new Promise((resolve) => {
			db.serialize(() => {
				db.run("DELETE FROM meetings", () => {
					db.run("DELETE FROM meeting_attendees", () => {
						db.run("DELETE FROM meeting_reminders_sent", () => {
							db.run("DELETE FROM meeting_attendance_pings", resolve);
						});
					});
				});
			});
		});
	});

	test('should create and retrieve a meeting successfully', async () => {
		const scheduledTime = Date.now() + 1000 * 60 * 60; // 1 hour future
		const meeting = {
			id: testMeetingId,
			title: 'Test Code Review',
			description: 'Reviewing meetings scheduler code',
			scheduledTime: scheduledTime,
			locationType: 'discord_vc',
			locationDetails: 'EVENTS',
			creatorId: 'user_creator_id'
		};

		await meetingsDb.createMeeting(meeting);
		await meetingsDb.addAttendee(testMeetingId, 'user', 'attendee_user_1');
		await meetingsDb.addAttendee(testMeetingId, 'role', 'attendee_role_1');

		const retrieved = await meetingsDb.getMeeting(testMeetingId);
		expect(retrieved).not.toBeNull();
		expect(retrieved.title).toBe('Test Code Review');
		expect(retrieved.description).toBe('Reviewing meetings scheduler code');
		expect(retrieved.scheduled_time).toBe(scheduledTime);
		expect(retrieved.location_type).toBe('discord_vc');
		expect(retrieved.creator_id).toBe('user_creator_id');
		expect(retrieved.status).toBe('scheduled');
		
		expect(retrieved.attendees).toHaveLength(2);
		expect(retrieved.attendees).toContainEqual({ type: 'user', discordId: 'attendee_user_1' });
		expect(retrieved.attendees).toContainEqual({ type: 'role', discordId: 'attendee_role_1' });
	});

	test('should track sent reminders', async () => {
		const id = 'meet_reminder_test';
		await meetingsDb.createMeeting({
			id,
			title: 'Reminder Test',
			description: 'Test description',
			scheduledTime: Date.now() + 60000,
			locationType: 'external',
			locationDetails: 'https://test.com',
			creatorId: 'creator'
		});

		let sent = await meetingsDb.hasReminderBeenSent(id, '12h');
		expect(sent).toBe(false);

		await meetingsDb.recordReminderSent(id, '12h');
		sent = await meetingsDb.hasReminderBeenSent(id, '12h');
		expect(sent).toBe(true);
	});

	test('should track attendance ping timers', async () => {
		const meetingId = 'meet_ping_test';
		const userId = 'user_ping_1';

		let lastPing = await meetingsDb.getLastPingTime(meetingId, userId);
		expect(lastPing).toBe(0);

		await meetingsDb.updateLastPingTime(meetingId, userId);
		lastPing = await meetingsDb.getLastPingTime(meetingId, userId);
		expect(lastPing).toBeGreaterThan(0);
		expect(Date.now() - lastPing).toBeLessThan(1000);
	});

	test('should update status and temp channel ID', async () => {
		const id = 'meet_update_test';
		await meetingsDb.createMeeting({
			id,
			title: 'Update Test',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'creator'
		});

		await meetingsDb.updateMeetingStatus(id, 'active');
		await meetingsDb.setTempChannelId(id, 'voice_chan_999');

		const retrieved = await meetingsDb.getMeeting(id);
		expect(retrieved.status).toBe('active');
		expect(retrieved.temp_channel_id).toBe('voice_chan_999');

		const match = await meetingsDb.findMeetingByTempChannel('voice_chan_999');
		expect(match).not.toBeNull();
		expect(match.id).toBe(id);
	});
});

describe('Slash Command: /meet-schedule Authorization', () => {
	let mockInteraction;
	let mockMember;
	let mockGuild;

	beforeEach(() => {
		mockMember = {
			roles: {
				cache: {
					has: jest.fn().mockReturnValue(false),
				},
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
		};

		mockGuild = {
			members: {
				fetch: jest.fn().mockResolvedValue(mockMember),
			},
			channels: {
				cache: {
					find: jest.fn().mockReturnValue({
						send: jest.fn().mockResolvedValue(true),
					}),
				},
			},
		};

		mockInteraction = {
			user: { id: 'user_123', tag: 'user#1234' },
			guild: mockGuild,
			reply: jest.fn().mockResolvedValue(true),
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			options: {
				getString: jest.fn(),
				getUser: jest.fn(),
				getRole: jest.fn(),
				getBoolean: jest.fn(),
			},
		};
	});

	test('should deny access if member does not have authorized roles or admin', async () => {
		await execute(mockInteraction);

		expect(mockInteraction.reply).toHaveBeenCalled();
		const replyArg = mockInteraction.reply.mock.calls[0][0];
		expect(replyArg.embeds[0].data.title).toContain('PROTOCOL_UNAUTHORIZED');
	});

	test('should defer reply if member has authorized staff role', async () => {
		// Mock authorized role
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');
		
		mockInteraction.options.getString.mockImplementation((name) => {
			if (name === 'title') return 'Test VC';
			if (name === 'date') return '2026-12-31';
			if (name === 'time') return '15:00';
			if (name === 'location-type') return 'discord_vc';
			return null;
		});
		mockInteraction.options.getUser.mockReturnValue({ id: 'user_invite_id' });

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
	});

	test('should schedule instantly if instant option is set to true', async () => {
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');
		
		mockInteraction.options.getString.mockImplementation((name) => {
			if (name === 'title') return 'Instant VC';
			if (name === 'location-type') return 'discord_vc';
			return null;
		});
		mockInteraction.options.getBoolean.mockReturnValue(true);
		mockInteraction.options.getUser.mockReturnValue({ id: 'user_invite_id', send: jest.fn().mockResolvedValue(true) });

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalled();
	});

	test('should reject past date/time', async () => {
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');
		
		mockInteraction.options.getString.mockImplementation((name) => {
			if (name === 'title') return 'Past Meeting';
			if (name === 'date') return '2020-01-01';
			if (name === 'time') return '12:00';
			if (name === 'location-type') return 'discord_vc';
			return null;
		});

		await execute(mockInteraction);

		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('Invalid date/time')
		}));
	});
});
