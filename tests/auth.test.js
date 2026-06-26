/**
 * Unit tests for lib/auth.js
 */

const notion = require('../lib/notion');
const { isAuthorizedForCity, isAuthorizedForForkId, getCoreAdminRoles, getCoreAdminAndParentRoles } = require('../lib/auth');

describe('Auth Layer Tests', () => {
	let mockUser;
	let mockGuild;
	let mockMember;

	const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '1506323726223016149';
	const FORK_LEAD_ROLE_ID = process.env.FORK_LEAD_ROLE_ID || '1490410901147488286';

	beforeEach(() => {
		jest.clearAllMocks();

		jest.spyOn(notion, 'findForkByCity').mockImplementation(() => {});
		jest.spyOn(notion, 'findTeamMember').mockImplementation(() => {});
		jest.spyOn(notion, 'getLeadDiscordId').mockImplementation(fork => fork?.properties?.['Discord ID']?.rich_text?.[0]?.text?.content || null);
		jest.spyOn(notion, 'getCityName').mockImplementation(fork => fork?.properties?.['What city are you in?']?.rich_text?.[0]?.text?.content || fork?.properties?.City?.rich_text?.[0]?.text?.content || null);
		jest.spyOn(notion, 'retrievePage').mockImplementation(() => {});

		mockUser = { id: 'user_123' };
		mockMember = {
			roles: {
				cache: {
					has: jest.fn().mockReturnValue(false),
				},
				highest: {
					position: 10,
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
			roles: {
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === STAFF_ROLE_ID) {
							return { id: STAFF_ROLE_ID, name: 'staff' };
						}
						if (id === FORK_LEAD_ROLE_ID) {
							return { id: FORK_LEAD_ROLE_ID, name: 'fork-lead', position: 10 };
						}
						return null;
					}),
					find: jest.fn().mockReturnValue({ id: FORK_LEAD_ROLE_ID, name: 'fork-lead', position: 10 }),
				},
			},
		};
	});

	describe('isAuthorizedForCity', () => {
		test('should authorize staff role users', async () => {
			mockMember.roles.cache.has.mockImplementation((roleId) => roleId === STAFF_ROLE_ID);
			
			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(mockGuild.members.fetch).toHaveBeenCalledWith('user_123');
		});

		test('should authorize HQ role users (admin bypass) by ID', async () => {
			mockMember.roles.cache.has.mockImplementation((roleId) => roleId === '1509256369994203146');
			
			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
		});

		test('should not authorize users with ManageRoles permissions unless they are lead/staff', async () => {
			mockMember.permissions.has.mockImplementation((perm) => perm === 'ManageRoles');
			notion.findForkByCity.mockResolvedValue(null);
			
			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(false);
		});

		test('should authorize users with Administrator permissions', async () => {
			mockMember.permissions.has.mockImplementation((perm) => perm === 'Administrator');
			
			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
		});

		test('should authorize the fork lead of that specific city', async () => {
			// Mock fork lookup where this user is the lead
			notion.findForkByCity.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'user_123' } }],
					},
				},
			});

			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(notion.findForkByCity).toHaveBeenCalledWith('Delhi');
		});

		test('should authorize team members of that specific city', async () => {
			// User is NOT lead
			notion.findForkByCity.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'another_lead_id' } }],
					},
				},
			});

			// User IS team member
			notion.findTeamMember.mockResolvedValue({
				id: 'team_member_id',
				properties: {
					'Role': { select: { name: 'Tech Lead' } },
				},
			});

			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(notion.findTeamMember).toHaveBeenCalledWith('fork_delhi', 'user_123');
		});

		test('should deny access if user has no role, is not lead, and is not a team member', async () => {
			notion.findForkByCity.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'another_lead_id' } }],
					},
				},
			});

			notion.findTeamMember.mockResolvedValue(null);

			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(false);
		});

		test('should deny access if the city fork does not exist', async () => {
			notion.findForkByCity.mockResolvedValue(null);

			const result = await isAuthorizedForCity(mockUser, 'UnknownCity', mockGuild);
			
			expect(result).toBe(false);
		});

		test('should authorize user even if highest role position is lower than fork-lead if they are lead', async () => {
			mockMember.roles.highest.position = 5; // lower than 10
			
			// Try to authorize a lead
			notion.findForkByCity.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'user_123' } }],
					},
				},
			});

			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			expect(result).toBe(true);
		});

		test('should deny access if fork-lead role is missing from guild', async () => {
			mockGuild.roles.cache.find.mockReturnValue(null);
			mockGuild.roles.cache.get.mockReturnValue(null);
			notion.findForkByCity.mockResolvedValue(null);

			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			expect(result).toBe(false);
		});
	});

	describe('isAuthorizedForForkId', () => {
		test('should authorize staff users', async () => {
			mockMember.roles.cache.has.mockImplementation((roleId) => roleId === STAFF_ROLE_ID);

			const result = await isAuthorizedForForkId(mockUser, 'fork_delhi', mockGuild);
			
			expect(result).toBe(true);
		});

		test('should authorize the fork lead', async () => {
			notion.retrievePage.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'user_123' } }],
					},
				},
			});

			const result = await isAuthorizedForForkId(mockUser, 'fork_delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(notion.retrievePage).toHaveBeenCalledWith('fork_delhi');
		});

		test('should authorize active team members', async () => {
			notion.retrievePage.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'another_lead_id' } }],
					},
				},
			});

			notion.findTeamMember.mockResolvedValue({ id: 'tm_member' });

			const result = await isAuthorizedForForkId(mockUser, 'fork_delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(notion.findTeamMember).toHaveBeenCalledWith('fork_delhi', 'user_123');
		});

		test('should deny access if unauthorized', async () => {
			notion.retrievePage.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'another_lead_id' } }],
					},
				},
			});

			notion.findTeamMember.mockResolvedValue(null);

			const result = await isAuthorizedForForkId(mockUser, 'fork_delhi', mockGuild);
			
			expect(result).toBe(false);
		});
	});
});

describe('User Availability Contributor Restriction & Cleanup', () => {
	let mockClient;
	let mockGuild;
	const { runUserCleanup, sessions } = require('../server');
	const db = require('../lib/db');

	beforeEach(() => {
		jest.clearAllMocks();

		mockGuild = {
			id: '1480617556292272260',
			members: {
				fetch: jest.fn().mockResolvedValue(true),
				cache: {
					get: jest.fn().mockImplementation((id) => {
						if (id === 'user_contributor') {
							return {
								id: 'user_contributor',
								roles: {
									cache: {
										some: (fn) => fn({ name: 'Contributor' })
									}
								}
							};
						}
						if (id === 'user_stranger') {
							return {
								id: 'user_stranger',
								roles: {
									cache: {
										some: (fn) => fn({ name: 'OtherRole' })
									}
								}
							};
						}
						return null; // Left server / kicked
					})
				}
			}
		};

		mockClient = {
			guilds: {
				cache: {
					get: jest.fn().mockReturnValue(mockGuild)
				}
			}
		};

		jest.spyOn(db, 'all').mockResolvedValue([
			{ discord_id: 'user_contributor', username: 'contrib' },
			{ discord_id: 'user_stranger', username: 'strange' },
			{ discord_id: 'user_left', username: 'left' }
		]);
		jest.spyOn(db, 'run').mockResolvedValue(true);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('runUserCleanup should delete non-contributors and members who left, and clear their sessions', async () => {
		// Setup mock sessions
		sessions.clear();
		sessions.set('sid_contrib', { id: 'user_contributor', username: 'contrib' });
		sessions.set('sid_strange', { id: 'user_stranger', username: 'strange' });
		sessions.set('sid_left', { id: 'user_left', username: 'left' });

		await runUserCleanup(mockClient);

		// Assert db.run was called to delete user_stranger and user_left
		expect(db.run).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_availability'), ['user_stranger']);
		expect(db.run).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_availability'), ['user_left']);
		// Assert contributor user is NOT deleted
		expect(db.run).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_availability'), ['user_contributor']);

		// Assert session cleanup
		expect(sessions.has('sid_contrib')).toBe(true);
		expect(sessions.has('sid_strange')).toBe(false);
		expect(sessions.has('sid_left')).toBe(false);
	});
});

describe('Core Admin and Parent Role Resolution', () => {
	let mockGuild;
	beforeEach(() => {
		mockGuild = {
			roles: {
				cache: [
					{ id: 'hq_role_id', name: 'HQ' },
					{ id: '1509256369994203146', name: 'staff' },
					{ id: 'dept_lead_id', name: 'Creative Department Lead' },
					{ id: 'another_dept_id', name: 'Department Lead' },
					{ id: 'tech_contrib_id', name: 'Tech Contributor' },
					{ id: 'creative_id', name: 'creative' },
					{ id: 'builder_id', name: 'builder' },
					{ id: '1509224762906247178', name: 'outreach-lead' },
					{ id: '1509224752747909351', name: 'outreach' }
				]
			}
		};
	});

	test('getCoreAdminRoles should retrieve hq, staff matching ID, and department leads', () => {
		const roles = getCoreAdminRoles(mockGuild);
		const ids = roles.map(r => r.id);
		
		expect(ids).toContain('hq_role_id');
		expect(ids).toContain('1509256369994203146');
		expect(ids).toContain('dept_lead_id');
		expect(ids).toContain('another_dept_id');
		expect(ids).toContain('1509224762906247178'); // outreach-lead by ID
		expect(ids).not.toContain('tech_contrib_id');
		expect(ids).not.toContain('creative_id');
		expect(ids).not.toContain('1509224752747909351'); // outreach contributor should not be in core admins
	});

	test('getCoreAdminAndParentRoles should retrieve admins plus parent track contributors', () => {
		const roles = getCoreAdminAndParentRoles(mockGuild);
		const ids = roles.map(r => r.id);
		
		expect(ids).toContain('hq_role_id');
		expect(ids).toContain('tech_contrib_id');
		expect(ids).toContain('1509224762906247178'); // admin outreach-lead
		expect(ids).toContain('1509224752747909351'); // parent track outreach contributor by ID
		expect(ids).toContain('creative_id'); // creative is resolved as a parent track role name
		expect(ids).not.toContain('builder_id');
	});
});

