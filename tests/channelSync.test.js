/**
 * Unit tests for lib/channelSync.js
 */

const notion = require('../lib/notion');
const logger = require('../lib/logger');
const { syncForkPermissions } = require('../lib/channelSync');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

describe('Channel Permissions Sync Tests', () => {
	let mockClient;
	let mockGuild;
	let mockFork;
	let mockCityRole;
	let mockForkLeadRole;
	let mockStaffRole;
	let mockChannel;

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();

		jest.spyOn(notion, 'getCityName').mockImplementation(() => {});
		jest.spyOn(notion, 'getLeadDiscordId').mockImplementation(() => {});
		jest.spyOn(notion, 'getTeamMembers').mockImplementation(() => {});
		jest.spyOn(notion, 'getForks').mockImplementation(() => {});

		jest.spyOn(logger, 'info').mockImplementation(() => {});
		jest.spyOn(logger, 'warn').mockImplementation(() => {});
		jest.spyOn(logger, 'error').mockImplementation(() => {});

		mockFork = { id: 'fork_delhi_page_id' };
		notion.getCityName.mockReturnValue('Delhi');
		notion.getLeadDiscordId.mockReturnValue('123');
		notion.getTeamMembers.mockResolvedValue([
			{ discordId: '456', role: 'tech-lead' },
			{ discordId: '789', role: 'creative-lead' },
		]);

		// Mock Discord Roles
		mockCityRole = { id: 'city_role_id', name: 'Delhi' };
		const mockContributorCityRole = { id: 'contrib_city_role_id', name: 'contributor-Delhi' };
		const mockContributorRole = { id: 'contributor_role_id', name: 'contributor' };
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
					has: jest.fn().mockReturnValue(false), // Missing all roles
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
					has: jest.fn().mockReturnValue(true), // Has all roles
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
					has: jest.fn().mockImplementation((roleId) => {
						return roleId === 'city_role_id' || roleId === 'contrib_city_role_id';
					}),
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

		const mockTargetChannel = {
			id: '1490416132262203533',
			permissionOverwrites: {
				edit: jest.fn().mockResolvedValue(true),
			},
		};

		const mockRolesMap = new Map([
			['city_role_id', mockCityRole],
			['contrib_city_role_id', mockContributorCityRole],
			['contributor_role_id', mockContributorRole],
			['fork_lead_role_id', mockForkLeadRole],
			['staff_role_id', mockStaffRole]
		]);
		mockRolesMap.find = jest.fn().mockImplementation((fn) => {
			return Array.from(mockRolesMap.values()).find(fn) || null;
		});

		mockGuild = {
			name: 'Test Guild',
			roles: {
				everyone: { id: 'everyone_role_id' },
				cache: mockRolesMap,
				create: jest.fn().mockImplementation((options) => {
					let role;
					if (options.name === 'Delhi') role = mockCityRole;
					else if (options.name === 'contributor-Delhi') role = mockContributorCityRole;
					else if (options.name === 'contributor') role = mockContributorRole;
					else role = { id: `role_${options.name.toLowerCase().replace(/\s+/g, '-')}`, name: options.name };
					mockRolesMap.set(role.id, role);
					return Promise.resolve(role);
				}),
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
				fetch: jest.fn().mockImplementation((id) => {
					if (id === '1490416132262203533') return Promise.resolve(mockTargetChannel);
					return Promise.resolve(null);
				}),
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === '1490416132262203533') return mockTargetChannel;
						return null;
					}),
					find: jest.fn().mockImplementation((fn) => {
						const dummyChannel = { name: 'gobitsnbytes-delhi' };
						if (fn(dummyChannel)) return mockChannel;
						return null;
					}),
				},
			},
		};

		mockGuild.mockTargetChannel = mockTargetChannel;

		mockClient = {
			guilds: {
				cache: new Map([['guild_abc', mockGuild]]),
			},
		};
	});

	test('should assign missing City Roles to registered team members and remove from unauthorized members', async () => {
		const mockTeamMember1 = mockGuild.members.cache.get('456');
		const mockExtraMember = mockGuild.members.cache.get('999');

		await syncForkPermissions(mockClient, mockFork);

		// Assertions
		expect(mockTeamMember1.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'Delhi' }));
		expect(mockTeamMember1.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'contributor-Delhi' }));
		expect(mockTeamMember1.roles.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'contributor' }));
		expect(mockExtraMember.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'contributor-Delhi' }));
	});

	test('should set correct permission overwrites for the channel', async () => {
		await syncForkPermissions(mockClient, mockFork);

		expect(mockChannel.permissionOverwrites.set).toHaveBeenCalled();
		const setCallArgs = mockChannel.permissionOverwrites.set.mock.calls[0][0];

		// check everyone denied
		const everyoneOver = setCallArgs.find(o => o.id === 'everyone_role_id');
		expect(everyoneOver).toBeDefined();
		expect(everyoneOver.deny).toContain(PermissionFlagsBits.ViewChannel);

		// check contributor-city role is allowed View & Send
		const contribCityOver = setCallArgs.find(o => o.id === 'contrib_city_role_id');
		expect(contribCityOver).toBeDefined();
		expect(contribCityOver.allow).toContain(PermissionFlagsBits.SendMessages);

		// check lead is admin
		const leadOver = setCallArgs.find(o => o.id === '123');
		expect(leadOver).toBeDefined();
		expect(leadOver.allow).toContain(PermissionFlagsBits.ManageChannels);

		// check contributor role is denied ViewChannel
		const contributorOver = setCallArgs.find(o => o.id === 'contributor_role_id');
		expect(contributorOver).toBeDefined();
		expect(contributorOver.deny).toContain(PermissionFlagsBits.ViewChannel);

		// check staff role is allowed
		const staffOver = setCallArgs.find(o => o.id === 'staff_role_id');
		expect(staffOver).toBeDefined();
		expect(staffOver.allow).toContain(PermissionFlagsBits.ViewChannel);

		// check a global track role (like tech) is denied
		const techOver = setCallArgs.find(o => o.id === 'role_tech');
		expect(techOver).toBeDefined();
		expect(techOver.deny).toContain(PermissionFlagsBits.ViewChannel);
	});

	test('should grant creative role access to channel 1490416132262203533', async () => {
		await syncForkPermissions(mockClient, mockFork);

		expect(mockGuild.mockTargetChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
			'role_creative',
			expect.objectContaining({
				ViewChannel: true,
				SendMessages: true,
			}),
			expect.any(Object)
		);
	});

	test('should remove track roles from non-staff and non-contributor members', async () => {
		// Mock a guild member who is not staff and has no contributor role, but has a track role
		const mockBadMember = {
			id: '444',
			roles: {
				cache: {
					has: jest.fn().mockImplementation((roleId) => {
						// Pretend they have the 'role_tech' track role
						return roleId === 'role_tech';
					}),
				},
				remove: jest.fn().mockResolvedValue(true),
			},
		};

		// Add this bad member to our guild mock
		mockGuild.members.cache.set('444', mockBadMember);

		await syncForkPermissions(mockClient, mockFork);

		// Expect that they got the track role removed
		expect(mockBadMember.roles.remove).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'role_tech' }),
			expect.any(String)
		);
	});
});
