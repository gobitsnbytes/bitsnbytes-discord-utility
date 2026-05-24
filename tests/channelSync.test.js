/**
 * Unit tests for lib/channelSync.js
 */

const { syncForkPermissions } = require('../lib/channelSync');
const notion = require('../lib/notion');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

// Mock notion module
jest.mock('../lib/notion', () => ({
	getCityName: jest.fn(),
	getLeadDiscordId: jest.fn(),
	getTeamMembers: jest.fn(),
}));

// Mock logger to avoid cluttering test outputs
jest.mock('../lib/logger', () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
}));

describe('Channel Permissions Sync Tests', () => {
	let mockClient;
	let mockGuild;
	let mockFork;
	let mockCityRole;
	let mockForkLeadRole;
	let mockStaffRole;
	let mockChannel;

	beforeEach(() => {
		jest.clearAllMocks();

		mockFork = { id: 'fork_delhi_page_id' };
		notion.getCityName.mockReturnValue('Delhi');
		notion.getLeadDiscordId.mockReturnValue('123');
		notion.getTeamMembers.mockResolvedValue([
			{ discordId: '456', role: 'tech-lead' },
			{ discordId: '789', role: 'creative-lead' },
		]);

		// Mock Discord Roles
		mockCityRole = { id: 'city_role_id', name: 'Delhi' };
		mockForkLeadRole = { id: 'fork_lead_role_id', name: 'fork-lead', position: 10 };
		mockStaffRole = { id: 'staff_role_id', name: 'staff' };

		// Mock Channel
		mockChannel = {
			name: 'gobitsnbytes-delhi',
			permissionOverwrites: {
				set: jest.fn().mockResolvedValue(true),
			},
		};

		// Mock Members
		const mockLeadMember = {
			id: '123',
			roles: {
				cache: {
					has: jest.fn().mockReturnValue(true), // Already has role
					some: jest.fn().mockReturnValue(false),
				},
				highest: { position: 10 },
				add: jest.fn().mockResolvedValue(true),
				remove: jest.fn().mockResolvedValue(true),
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
		};

		const mockTeamMember1 = {
			id: '456',
			roles: {
				cache: {
					has: jest.fn().mockReturnValue(false), // Missing city role
					some: jest.fn().mockReturnValue(false),
				},
				highest: { position: 1 },
				add: jest.fn().mockResolvedValue(true),
				remove: jest.fn().mockResolvedValue(true),
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
		};

		const mockTeamMember2 = {
			id: '789',
			roles: {
				cache: {
					has: jest.fn().mockReturnValue(true), // Has city role
					some: jest.fn().mockReturnValue(false),
				},
				highest: { position: 1 },
				add: jest.fn().mockResolvedValue(true),
				remove: jest.fn().mockResolvedValue(true),
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
		};

		const mockExtraMember = {
			id: '999',
			roles: {
				cache: {
					has: jest.fn().mockImplementation((roleId) => roleId === 'city_role_id'), // Has city role but unauthorized
					some: jest.fn().mockReturnValue(false),
				},
				highest: { position: 1 },
				add: jest.fn().mockResolvedValue(true),
				remove: jest.fn().mockResolvedValue(true),
			},
			permissions: {
				has: jest.fn().mockReturnValue(false),
			},
		};

		mockGuild = {
			name: 'Test Guild',
			roles: {
				everyone: { id: 'everyone_role_id' },
				cache: {
					find: jest.fn().mockImplementation((fn) => {
						const dummyCityRole = { name: 'Delhi', id: 'city_role_id' };
						if (fn(dummyCityRole)) return dummyCityRole;
						return null;
					}),
					get: jest.fn().mockImplementation((id) => {
						if (id === 'fork_lead_role_id') return mockForkLeadRole;
						if (id === 'staff_role_id') return mockStaffRole;
						return null;
					}),
				},
				create: jest.fn().mockResolvedValue(mockCityRole),
			},
			members: {
				fetch: jest.fn().mockResolvedValue(true),
				cache: (() => {
					const map = new Map([
						['123', mockLeadMember],
						['456', mockTeamMember1],
						['789', mockTeamMember2],
						['999', mockExtraMember],
					]);
					map.filter = jest.fn().mockImplementation((fn) => {
						const res = new Map();
						for (const [k, v] of map) {
							if (fn(v, k)) res.set(k, v);
						}
						return res;
					});
					return map;
				})(),
			},
			channels: {
				cache: {
					find: jest.fn().mockImplementation((fn) => {
						const dummyChannel = { name: 'gobitsnbytes-delhi' };
						if (fn(dummyChannel)) return mockChannel;
						return null;
					}),
				},
			},
		};

		mockClient = {
			guilds: {
				cache: new Map([['guild_abc', mockGuild]]),
			},
		};
	});

	test('should assign missing City Role to registered team members and remove from unauthorized members', async () => {
		const mockTeamMember1 = mockGuild.members.cache.get('456');
		const mockExtraMember = mockGuild.members.cache.get('999');

		await syncForkPermissions(mockClient, mockFork);

		// Assertions
		expect(mockTeamMember1.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Delhi' }));
		expect(mockExtraMember.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Delhi' }));
	});

	test('should set correct permission overwrites for the channel', async () => {
		// Mock member role checks inside the loop
		const mockLeadMember = mockGuild.members.cache.get('123');
		const mockTeamMember1 = mockGuild.members.cache.get('456');
		const mockTeamMember2 = mockGuild.members.cache.get('789');

		// Set mock roles.cache.has responses for the cityRole check inside desiredPermissions filter
		mockLeadMember.roles.cache.has.mockReturnValue(true);
		mockTeamMember1.roles.cache.has.mockReturnValue(true);
		mockTeamMember2.roles.cache.has.mockReturnValue(true);

		// Modify team member 1 mock implementation to simulate it now has the city role after assignment
		mockTeamMember1.roles.cache.has.mockImplementation((roleId) => roleId === 'city_role_id');

		await syncForkPermissions(mockClient, mockFork);

		expect(mockChannel.permissionOverwrites.set).toHaveBeenCalled();
		const setCallArgs = mockChannel.permissionOverwrites.set.mock.calls[0][0];

		// check everyone denied
		const everyoneOver = setCallArgs.find(o => o.id === 'everyone_role_id');
		expect(everyoneOver).toBeDefined();
		expect(everyoneOver.deny).toContain(PermissionFlagsBits.ViewChannel);

		// check lead is admin
		const leadOver = setCallArgs.find(o => o.id === '123');
		expect(leadOver).toBeDefined();
		expect(leadOver.allow).toContain(PermissionFlagsBits.ManageChannels);

		// check team member 1 is member
		const member1Over = setCallArgs.find(o => o.id === '456');
		expect(member1Over).toBeDefined();
		expect(member1Over.allow).toContain(PermissionFlagsBits.SendMessages);
		expect(member1Over.allow).not.toContain(PermissionFlagsBits.ManageChannels);
	});
});
