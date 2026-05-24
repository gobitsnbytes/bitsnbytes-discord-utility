/**
 * Unit tests for lib/auth.js
 */

const { isAuthorizedForCity, isAuthorizedForForkId } = require('../lib/auth');
const notion = require('../lib/notion');

// Mock notion module
jest.mock('../lib/notion', () => ({
	findForkByCity: jest.fn(),
	findTeamMember: jest.fn(),
	pages: {
		retrieve: jest.fn(),
	},
}));

describe('Auth Layer Tests', () => {
	let mockUser;
	let mockGuild;
	let mockMember;

	const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '1506019068132462804';
	const FORK_LEAD_ROLE_ID = process.env.FORK_LEAD_ROLE_ID || '1490410901147488286';

	beforeEach(() => {
		jest.clearAllMocks();

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

		test('should authorize users with ManageRoles permissions', async () => {
			mockMember.permissions.has.mockImplementation((perm) => perm === 'ManageRoles');
			
			const result = await isAuthorizedForCity(mockUser, 'Delhi', mockGuild);
			
			expect(result).toBe(true);
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
			notion.pages.retrieve.mockResolvedValue({
				id: 'fork_delhi',
				properties: {
					'Discord ID': {
						rich_text: [{ text: { content: 'user_123' } }],
					},
				},
			});

			const result = await isAuthorizedForForkId(mockUser, 'fork_delhi', mockGuild);
			
			expect(result).toBe(true);
			expect(notion.pages.retrieve).toHaveBeenCalledWith({ page_id: 'fork_delhi' });
		});

		test('should authorize active team members', async () => {
			notion.pages.retrieve.mockResolvedValue({
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
			notion.pages.retrieve.mockResolvedValue({
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
