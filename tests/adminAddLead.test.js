const config = require('../config');

const notion = require('../lib/notion');

const meetingsDb = require('../lib/meetingsDb');
const { execute } = require('../commands/admin-add-lead');
const { ChannelType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let originalColors, originalEmojis, originalBranding, originalMergePrivacy;

beforeAll(() => {
	originalColors = { ...config.COLORS };
	originalEmojis = { ...config.EMOJIS };
	originalBranding = { ...config.BRANDING };
	originalMergePrivacy = config.PRIVACY.merge;

	Object.assign(config.COLORS, {
		success: '#00FF95',
		error: '#FF0055',
	});

	Object.assign(config.EMOJIS, {
		protocol: '⚛️',
		error: '❌',
	});

	config.BRANDING.footerText = 'TEST_FOOTER';
	config.PRIVACY.merge = true;
});

afterAll(() => {
	Object.assign(config.COLORS, originalColors);
	Object.assign(config.EMOJIS, originalEmojis);
	Object.assign(config.BRANDING, originalBranding);
	config.PRIVACY.merge = originalMergePrivacy;
	jest.restoreAllMocks();
});
const dbPath = require('../lib/db').dbPath;
const db = new sqlite3.Database(dbPath);

describe('Admin Add Lead Database helper tests', () => {
	const discordId = 'user_direct_123';
	const city = 'San Francisco';

	beforeAll(async () => {
		await meetingsDb.initPromise;
		await new Promise((resolve) => {
			db.run("DELETE FROM pending_notion_profiles", resolve);
		});
	});

	test('should add, fetch, and resolve a pending profile', async () => {
		// Clean / add
		await meetingsDb.addPendingProfile(discordId, city);

		let pending = await meetingsDb.getPendingProfiles();
		const match = pending.find(p => p.discord_id === discordId && p.city === city);
		expect(match).toBeDefined();
		expect(match.status).toBe('pending');

		// Resolve
		await meetingsDb.resolvePendingProfile(discordId, city);
		pending = await meetingsDb.getPendingProfiles();
		const matchAfter = pending.find(p => p.discord_id === discordId && p.city === city);
		expect(matchAfter).toBeUndefined();
	});

	test('should update last reminded time', async () => {
		const discId = 'user_direct_reminder';
		const targetCity = 'Paris';

		await meetingsDb.addPendingProfile(discId, targetCity);
		let pending = await meetingsDb.getPendingProfiles();
		const record = pending.find(p => p.discord_id === discId && p.city === targetCity);
		const initialTime = record.last_reminded_at;

		// Wait slightly or update
		await new Promise(r => setTimeout(r, 10));
		await meetingsDb.updateProfileReminderTime(discId, targetCity);

		pending = await meetingsDb.getPendingProfiles();
		const recordAfter = pending.find(p => p.discord_id === discId && p.city === targetCity);
		expect(recordAfter.last_reminded_at).toBeGreaterThan(initialTime);
	});
});

describe('Slash Command: /admin-add-lead Authorization', () => {
	let mockInteraction;
	let mockMember;
	let mockTargetMember;
	let mockGuild;

	beforeEach(() => {
		jest.clearAllMocks();

		jest.spyOn(notion, 'findForkByCity').mockImplementation(() => {});
		jest.spyOn(notion, 'updateForkStatus').mockImplementation(() => {});
		jest.spyOn(notion, 'getLeadDiscordId').mockImplementation(fork => fork?.properties?.['Discord ID']?.rich_text?.[0]?.text?.content || null);
		jest.spyOn(notion, 'getCityName').mockImplementation(fork => fork?.properties?.['What city are you in?']?.rich_text?.[0]?.text?.content || fork?.properties?.City?.rich_text?.[0]?.text?.content || null);

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

		mockTargetMember = {
			roles: {
				add: jest.fn().mockResolvedValue(true),
			},
		};

		mockGuild = {
			members: {
				fetch: jest.fn().mockImplementation((id) => {
					if (id === 'user_target_id') return Promise.resolve(mockTargetMember);
					return Promise.resolve(mockMember);
				}),
			},
			roles: {
				everyone: { id: 'everyone_role_id' },
				cache: {
					find: jest.fn().mockReturnValue({ id: 'fork_lead_role_id', name: 'fork-lead' }),
					get: jest.fn().mockReturnValue({ id: '1480620981587279993' }),
				},
			},
			channels: {
				cache: {
					find: jest.fn().mockImplementation((fn) => {
						const dummyChannel = { name: 'FORKS', type: ChannelType.GuildCategory, id: 'forks_category_id' };
						if (fn(dummyChannel)) {
							return dummyChannel;
						}
						return null;
					}),
				},
				create: jest.fn().mockResolvedValue({ id: 'new_channel_id' }),
			},
			iconURL: jest.fn().mockReturnValue('https://discord.com/icon.png'),
		};

		mockInteraction = {
			user: { id: 'user_admin_id' },
			guild: mockGuild,
			reply: jest.fn().mockResolvedValue(true),
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			options: {
				getUser: jest.fn().mockReturnValue({ id: 'user_target_id', send: jest.fn() }),
				getString: jest.fn().mockReturnValue('San Francisco'),
			},
		};
	});

	test('should deny access if member does not have admin/staff roles', async () => {
		await execute(mockInteraction);

		expect(mockInteraction.reply).toHaveBeenCalled();
		const replyArg = mockInteraction.reply.mock.calls[0][0];
		expect(replyArg.embeds[0].data.title).toContain('PROTOCOL_UNAUTHORIZED');
	});

	test('should onboard and sync if user has Notion entry', async () => {
		mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1480620981587279993');
		notion.findForkByCity.mockResolvedValue({ id: 'fork_page_id' });

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockTargetMember.roles.add).toHaveBeenCalled();
		expect(notion.updateForkStatus).toHaveBeenCalledWith('fork_page_id', 'Active', 'user_target_id');
	});
});
