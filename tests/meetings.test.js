const config = require('../config');
console.log("CONFIG KEYS AT TOP:", Object.keys(config));
const meetingsDb = require('../lib/meetingsDb');
const { execute } = require('../commands/meet-schedule');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = require('../lib/db').dbPath;
const db = new sqlite3.Database(dbPath);

jest.mock('../lib/motherboardApi', () => ({
	callMotherboard: jest.fn()
}));
const { callMotherboard } = require('../lib/motherboardApi');

let originalColors, originalEmojis, originalBranding, originalContributorRole, originalSchedulePrivacy;

beforeAll(() => {
	originalColors = { ...config.COLORS };
	originalEmojis = { ...config.EMOJIS };
	originalBranding = { ...config.BRANDING };
	originalContributorRole = config.ROLE_IDS.contributor;
	originalSchedulePrivacy = config.PRIVACY['meet-schedule'];

	Object.assign(config.COLORS, {
		primary: '#00F2FF',
		success: '#00FF95',
		warning: '#FFCC00',
		error: '#FF0055',
	});

	Object.assign(config.EMOJIS, {
		calendar: '📆',
		reminder: '🔔',
		error: '❌',
	});

	config.BRANDING.footerText = 'TEST_FOOTER';
	config.ROLE_IDS.contributor = 'contrib_role_123';
	config.PRIVACY['meet-schedule'] = true;
});

afterAll(() => {
	Object.assign(config.COLORS, originalColors);
	Object.assign(config.EMOJIS, originalEmojis);
	Object.assign(config.BRANDING, originalBranding);
	config.ROLE_IDS.contributor = originalContributorRole;
	config.PRIVACY['meet-schedule'] = originalSchedulePrivacy;
});

let originalRecordingEnabled;
beforeAll(() => {
	originalRecordingEnabled = process.env.RECORDING_ENABLED;
	process.env.RECORDING_ENABLED = 'false';
});

afterAll(() => {
	process.env.RECORDING_ENABLED = originalRecordingEnabled;
	db.close();
	require('../lib/listenerManager').closePool();
});

describe('Meeting Scheduler Database Tests', () => {
	const testMeetingId = 'meet_test_123';

	beforeAll(async () => {
		// Wait for meetingsDb migrations to complete
		await meetingsDb.initPromise;

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

		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Ping Test Meeting',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'creator'
		});

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
					some: jest.fn().mockReturnValue(false),
				},
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
			user: {
				bot: false
			},
			send: jest.fn().mockResolvedValue(true)
		};

		mockGuild = {
			id: 'guild_123',
			members: {
				fetch: jest.fn().mockResolvedValue(mockMember),
			},
			roles: {
				everyone: { id: 'everyone_role_id' },
				cache: {
					get: jest.fn().mockImplementation((id) => {
						return { id, name: id === '1509256369994203146' ? 'Staff' : 'Some Role' };
					}),
					find: jest.fn().mockReturnValue({ id: 'contrib_role_id' })
				}
			},
			channels: {
				cache: {
					find: jest.fn().mockReturnValue({
						id: 'events_category_id',
						send: jest.fn().mockResolvedValue(true),
					}),
				},
				create: jest.fn().mockResolvedValue({ id: 'temp_vc_chan_123', name: 'Temp VC' }),
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
				getInteger: jest.fn(),
			},
		};

		callMotherboard.mockImplementation((method, path, userId, body) => {
			if (method === 'POST' && path === '/api/meetings/schedule') {
				return Promise.resolve({
					id: 'meet_test_123',
					title: body.title || 'Test Meeting',
					description: body.description || '',
					scheduled_time: body.scheduled_time || Date.now(),
					duration_minutes: body.duration_minutes || 30,
					location_type: body.location_type || 'discord_vc',
					location_details: body.location_details || '',
					creator_id: userId,
					attendees: (body.invitees || []).map(inv => ({ attendee_type: inv.type, discord_id: inv.id })),
					external_emails: (body.external_emails || []).join(','),
					notes: body.notes || '',
					scope: body.scope || 'invite'
				});
			}
			if (method === 'PATCH' && path.startsWith('/api/meetings/')) {
				return Promise.resolve({
					success: true
				});
			}
			return Promise.reject(new Error(`Unexpected callMotherboard in test: ${method} ${path}`));
		});
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

describe('Slash Command: /meet-start', () => {
	let mockInteraction;
	let mockMember;
	let mockGuild;
	const { execute } = require('../commands/meet-start');

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
			voice: {
				channelId: 'voice_chan_999'
			},
			user: {
				bot: false
			},
			send: jest.fn().mockResolvedValue(true)
		};

		mockGuild = {
			id: 'guild_123',
			members: {
				fetch: jest.fn().mockResolvedValue(mockMember),
			},
			channels: {
				fetch: jest.fn().mockImplementation(async (id) => {
					if (id === '1508037242092912650') {
						return {
							id: '1508037242092912650',
							send: jest.fn().mockResolvedValue(true)
						};
					}
					return null;
				}),
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === 'voice_chan_999') {
							return {
								members: new Map(),
								id: 'voice_chan_999'
							};
						}
						return null;
					}),
					find: jest.fn().mockReturnValue({
						send: jest.fn().mockResolvedValue(true)
					})
				}
			}
		};

		mockInteraction = {
			user: { id: 'user_123', tag: 'user#1234' },
			guild: mockGuild,
			reply: jest.fn().mockResolvedValue(true),
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			options: {
				getString: jest.fn().mockReturnValue(null),
			},
			client: {
				user: { id: 'bot_id' }
			}
		};

		callMotherboard.mockImplementation((method, path, userId, body) => {
			const meetingId = 'meet_start_test';
			if (method === 'GET' && path === `/api/meetings/${meetingId}`) {
				return Promise.resolve({
					id: meetingId,
					title: 'Start Test Meeting',
					scheduled_time: Date.now() + 60000,
					duration_minutes: 30,
					location_type: 'discord_vc',
					location_details: '',
					creator_id: 'user_123',
					status: 'scheduled',
					attendees: [
						{ attendee_type: 'user', discord_id: 'user_invite_id' }
					],
					external_emails: '',
					scope: 'invite'
				});
			}
			if (method === 'POST' && path === `/api/meetings/${meetingId}/start`) {
				return meetingsDb.updateMeetingStatus(meetingId, 'active').then(() => ({
					id: meetingId,
					title: 'Start Test Meeting',
					scheduled_time: Date.now() + 60000,
					duration_minutes: 30,
					location_type: 'discord_vc',
					location_details: '',
					creator_id: 'user_123',
					status: 'active',
					attendees: [
						{ attendee_type: 'user', discord_id: 'user_invite_id' }
					],
					external_emails: '',
					scope: 'invite'
				}));
			}
			return Promise.reject(new Error(`Unexpected callMotherboard in test: ${method} ${path}`));
		});
	});

	test('should deny access to unauthorized users', async () => {
		await execute(mockInteraction);
		expect(mockInteraction.reply).toHaveBeenCalled();
		const replyArg = mockInteraction.reply.mock.calls[0][0];
		expect(replyArg.embeds[0].data.title).toContain('PROTOCOL_UNAUTHORIZED');
	});

	test('should start meeting successfully if authorized', async () => {
		// Mock authorized role
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');
		
		// Create a mock meeting in DB
		const meetingId = 'meet_start_test';
		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Start Test Meeting',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'user_123',
			status: 'scheduled'
		});
		await meetingsDb.setTempChannelId(meetingId, 'voice_chan_999');

		mockInteraction.options.getString.mockReturnValue(meetingId);

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('started successfully')
		}));

		const retrieved = await meetingsDb.getMeeting(meetingId);
		expect(retrieved.status).toBe('active');
	});
});

describe('meetingsHelper.createMeetingVoiceChannel Permissions', () => {
	let mockGuild;

	beforeEach(() => {
		mockGuild = {
			id: 'guild_123',
			members: {
				fetch: jest.fn().mockResolvedValue({}),
				cache: { filter: jest.fn().mockReturnValue({ forEach: jest.fn(), size: 0 }) }
			},
			roles: {
				everyone: { id: 'everyone_role_id' },
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === 'staff_role_id') return { id: 'staff_role_id', name: 'Staff' };
						return null;
					}),
					find: jest.fn().mockImplementation((fn) => {
						const dummyRoles = [
							{ id: 'contrib_role_123', name: 'contributor' },
							{ id: 'hq_role_456', name: 'hq' },
							{ id: 'staff_role_id', name: 'Staff' }
						];
						return dummyRoles.find(fn);
					})
				}
			},
			client: {
				user: { id: 'bot_client_id' }
			},
			channels: {
				cache: {
					get: jest.fn(),
					find: jest.fn().mockReturnValue({ id: 'events_category_id', name: 'EVENTS', type: 4 })
				},
				create: jest.fn().mockImplementation(async (options) => {
					return {
						id: 'new_vc_channel_id',
						name: options.name,
						permissionOverwrites: options.permissionOverwrites
					};
				})
			}
		};
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('should configure overwrites for contributor role and fork role on open scope', async () => {
		const { createMeetingVoiceChannel } = require('../lib/meetingsHelper');
		const { PermissionFlagsBits } = require('discord.js');
		const meeting = {
			id: 'meet_test_open',
			title: 'Open Sync',
			creator_id: 'creator_id',
			scope: 'open',
			attendees: []
		};

		const channel = await createMeetingVoiceChannel(mockGuild, meeting);
		expect(channel).not.toBeNull();
		expect(mockGuild.channels.create).toHaveBeenCalled();
		
		const createArgs = mockGuild.channels.create.mock.calls[0][0];
		const overwrites = createArgs.permissionOverwrites;

		// Should deny everyone ViewChannel
		const everyoneOverwrite = overwrites.find(o => o.id === 'everyone_role_id');
		expect(everyoneOverwrite).toBeDefined();
		expect(everyoneOverwrite.deny).toContain(PermissionFlagsBits.ViewChannel);

		// Should allow general contributor role (open = contributors + hq)
		const contributorOverwrite = overwrites.find(o => o.id === 'contrib_role_123');
		expect(contributorOverwrite).toBeDefined();
		expect(contributorOverwrite.allow).toContain(PermissionFlagsBits.ViewChannel);

		// Should also allow the hq role (open includes Foundation team)
		const hqOverwrite = overwrites.find(o => o.id === 'hq_role_456');
		expect(hqOverwrite).toBeDefined();
		expect(hqOverwrite.allow).toContain(PermissionFlagsBits.ViewChannel);

		// Should NOT add creator's specific fork role anymore (that was old incorrect behaviour)
		const forkOverwrite = overwrites.find(o => o.id === 'creator_fork_role_id');
		expect(forkOverwrite).toBeUndefined();
	});
});

describe('meetingsDb.removeAttendee', () => {
	test('should remove attendee from database successfully', async () => {
		const meetingId = 'meet_remove_att_test';
		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Removal Test Meeting',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'creator_id'
		});

		await meetingsDb.addAttendee(meetingId, 'user', 'user_to_remove');
		let meeting = await meetingsDb.getMeeting(meetingId);
		expect(meeting.attendees.map(a => a.discordId)).toContain('user_to_remove');

		await meetingsDb.removeAttendee(meetingId, 'user_to_remove');
		meeting = await meetingsDb.getMeeting(meetingId);
		expect(meeting.attendees.map(a => a.discordId)).not.toContain('user_to_remove');
	});
});

describe('Slash Command: /meet-stop', () => {
	let mockInteraction;
	let mockMember;
	let mockGuild;
	const { execute } = require('../commands/meet-stop');

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
			voice: {
				channelId: 'voice_chan_999'
			},
			user: {
				bot: false
			},
			send: jest.fn().mockResolvedValue(true)
		};

		mockGuild = {
			id: 'guild_123',
			members: {
				fetch: jest.fn().mockResolvedValue(mockMember),
			},
			channels: {
				fetch: jest.fn().mockImplementation(async (id) => {
					if (id === '1508037242092912650') {
						return {
							id: '1508037242092912650',
							send: jest.fn().mockResolvedValue(true)
						};
					}
					return null;
				}),
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === 'voice_chan_999') {
							return {
								members: new Map(),
								id: 'voice_chan_999',
								delete: jest.fn().mockResolvedValue(true)
							};
						}
						return null;
					}),
					find: jest.fn().mockReturnValue({
						send: jest.fn().mockResolvedValue(true)
					})
				}
			}
		};

		mockInteraction = {
			user: { id: 'user_123', tag: 'user#1234' },
			guild: mockGuild,
			reply: jest.fn().mockResolvedValue(true),
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			options: {
				getString: jest.fn().mockReturnValue(null),
			},
			client: {
				user: { id: 'bot_id' }
			}
		};

		callMotherboard.mockImplementation((method, path, userId, body) => {
			const meetingId = 'meet_stop_test';
			if (method === 'GET' && path === `/api/meetings/${meetingId}`) {
				return Promise.resolve({
					id: meetingId,
					title: 'Stop Test Meeting',
					scheduled_time: Date.now() + 60000,
					duration_minutes: 30,
					location_type: 'discord_vc',
					location_details: '',
					creator_id: 'user_123',
					status: 'active',
					attendees: [
						{ attendee_type: 'user', discord_id: 'user_invite_id' }
					],
					external_emails: '',
					scope: 'invite'
				});
			}
			if (method === 'POST' && path === `/api/meetings/${meetingId}/stop`) {
				return meetingsDb.updateMeetingStatus(meetingId, 'completed').then(() => ({
					id: meetingId,
					title: 'Stop Test Meeting',
					scheduled_time: Date.now() + 60000,
					duration_minutes: 30,
					location_type: 'discord_vc',
					location_details: '',
					creator_id: 'user_123',
					status: 'completed',
					attendees: [
						{ attendee_type: 'user', discord_id: 'user_invite_id' }
					],
					external_emails: '',
					scope: 'invite'
				}));
			}
			return Promise.reject(new Error(`Unexpected callMotherboard in test: ${method} ${path}`));
		});
	});

	test('should deny access to unauthorized users', async () => {
		await execute(mockInteraction);
		expect(mockInteraction.reply).toHaveBeenCalled();
		const replyArg = mockInteraction.reply.mock.calls[0][0];
		expect(replyArg.embeds[0].data.title).toContain('PROTOCOL_UNAUTHORIZED');
	});

	test('should stop active meeting successfully if authorized', async () => {
		// Mock authorized role
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');

		// Create a mock meeting in DB
		const meetingId = 'meet_stop_test';
		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Stop Test Meeting',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'user_123',
			status: 'active'
		});
		await meetingsDb.setTempChannelId(meetingId, 'voice_chan_999');

		mockInteraction.options.getString.mockReturnValue(meetingId);

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('stopped successfully')
		}));

		const retrieved = await meetingsDb.getMeeting(meetingId);
		expect(retrieved.status).toBe('completed');
	});
});

describe('Meeting Recovery Job Tests', () => {
	const meetingRecovery = require('../jobs/meetingRecovery');

	test('should mark meeting as completed when metadata.json is missing', async () => {
		const meetingId = 'meet_stale_no_metadata';
		// Create an active meeting that is scheduled 4 hours ago
		const scheduledTime = Date.now() - 4 * 60 * 60 * 1000;
		
		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Stale VC Meeting',
			scheduledTime: scheduledTime,
			locationType: 'discord_vc',
			creatorId: 'user_123',
			status: 'active'
		});

		// Set temp_channel_id so it matches active VC meeting structure
		await meetingsDb.setTempChannelId(meetingId, 'voice_chan_stale');

		// Force created_at to be in the past to make it stale
		const db = require('../lib/db');
		await db.run(`UPDATE meetings SET created_at = ? WHERE id = ?`, [scheduledTime, meetingId]);

		const mockGuild = {
			id: 'guild_123',
			channels: {
				fetch: jest.fn().mockRejectedValue(new Error('Channel not found'))
			}
		};

		const mockClient = {
			guilds: {
				fetch: jest.fn().mockResolvedValue(mockGuild)
			}
		};

		process.env.GUILD_ID = 'guild_123';

		// Trigger recovery function directly
		await meetingRecovery.runRecovery(mockClient);

		// Assert that meeting is marked as completed (since metadata.json doesn't exist for it)
		const retrieved = await meetingsDb.getMeeting(meetingId);
		expect(retrieved.status).toBe('completed');

		// Also check that it's marked as failed in recording status
		const row = await require('../lib/db').get(`SELECT recording_status FROM meetings WHERE id = ?`, [meetingId]);
		expect(row.recording_status).toBe('failed');
	});
});

describe('Cal.com Sync Rescheduling Tests', () => {
	const calcomWebhook = require('../lib/calcomWebhook');
	const calcom = require('../lib/calcom');

	test('syncCalcomBookings should reschedule meeting in DB and delete sent reminders when start time changes', async () => {
		const calcomBookingId = 'calcom_booking_resched_123';
		const meetingId = `meet_cal_${calcomBookingId}`;
		const oldStartTime = Date.now() + 2 * 60 * 60 * 1000; // 2 hours in future
		const newStartTime = Date.now() + 4 * 60 * 60 * 1000; // 4 hours in future

		// Create meeting
		await meetingsDb.createMeeting({
			id: meetingId,
			title: 'Cal.com Sync Meeting',
			scheduledTime: oldStartTime,
			locationType: 'discord_vc',
			creatorId: 'user_123',
			status: 'scheduled',
			calcomBookingId
		});

		// Mock a sent reminder
		await meetingsDb.recordReminderSent(meetingId, '12h');
		let reminderSent = await meetingsDb.hasReminderBeenSent(meetingId, '12h');
		expect(reminderSent).toBe(true);

		// Mock calcom getUpcomingBookings
		jest.spyOn(calcom, 'getUpcomingBookings').mockResolvedValue([{
			id: calcomBookingId,
			title: 'Cal.com Sync Meeting',
			startTime: new Date(newStartTime).toISOString(),
			endTime: new Date(newStartTime + 30 * 60 * 1000).toISOString(),
			status: 'accepted',
			location: 'Discord VC'
		}]);

		// Mock events channel fetching/announcement to not crash
		const mockTextChannel = {
			send: jest.fn().mockResolvedValue(true)
		};
		const mockGuild = {
			id: 'guild_123',
			channels: {
				fetch: jest.fn().mockResolvedValue(mockTextChannel),
				cache: {
					find: jest.fn().mockReturnValue(mockTextChannel)
				}
			}
		};
		const mockClient = {
			guilds: {
				cache: {
					first: jest.fn().mockReturnValue(mockGuild)
				}
			}
		};

		// Run sync
		await calcomWebhook.syncCalcomBookings(mockClient);

		// Verify database was updated
		const retrieved = await meetingsDb.getMeeting(meetingId);
		expect(retrieved.scheduled_time).toBe(newStartTime);
		expect(retrieved.status).toBe('scheduled');

		// Verify reminders were cleared
		reminderSent = await meetingsDb.hasReminderBeenSent(meetingId, '12h');
		expect(reminderSent).toBe(false);

		jest.restoreAllMocks();
	});
});
