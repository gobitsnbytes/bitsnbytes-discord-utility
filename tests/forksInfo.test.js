/**
 * Unit tests for commands/forks-info.js
 */

const { execute, handleButton } = require('../commands/forks-info');
const notion = require('../lib/notion');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { MessageFlags } = require('discord.js');

// Mock notion
jest.mock('../lib/notion', () => ({
	getForks: jest.fn(),
	getLeadDiscordId: jest.fn(),
	getTeamMembers: jest.fn(),
	limitConcurrency: jest.fn().mockImplementation(async (tasks) => Promise.all(tasks.map(t => t()))),
}));

// Mock auth
jest.mock('../lib/auth', () => ({
	isStaff: jest.fn(),
}));

// Mock db
jest.mock('../lib/db', () => ({
	run: jest.fn().mockResolvedValue(true),
	get: jest.fn(),
}));

describe('Forks Info Command Tests', () => {
	let mockInteraction;
	let mockGuild;
	let mockChannel;
	let mockMessage;

	beforeEach(() => {
		jest.clearAllMocks();

		mockMessage = {
			id: 'existing_msg_999',
			url: 'https://discord.com/channels/123/456/999',
			edit: jest.fn().mockResolvedValue(true),
		};

		mockChannel = {
			id: 'channel_456',
			send: jest.fn().mockResolvedValue(mockMessage),
			messages: {
				fetch: jest.fn().mockResolvedValue(mockMessage),
			},
		};

		mockGuild = {
			channels: {
				fetch: jest.fn().mockResolvedValue(mockChannel),
			},
			members: {
				fetch: jest.fn().mockResolvedValue({}),
			},
			iconURL: jest.fn().mockReturnValue('https://discord.com/icon.png'),
		};

		mockInteraction = {
			user: { id: 'admin_user_id' },
			guild: mockGuild,
			channel: mockChannel,
			channelId: 'channel_456',
			reply: jest.fn().mockResolvedValue(true),
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			deferUpdate: jest.fn().mockResolvedValue(true),
			followUp: jest.fn().mockResolvedValue(true),
			message: mockMessage,
		};
	});

	test('should deny access if member is not staff', async () => {
		auth.isStaff.mockReturnValue(false);

		await execute(mockInteraction);

		expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
			flags: [MessageFlags.Ephemeral],
		}));
		expect(mockInteraction.reply.mock.calls[0][0].content).toContain('permission');
	});

	test('should post new message if no message was stored previously', async () => {
		auth.isStaff.mockReturnValue(true);
		db.get.mockResolvedValue(null); // No stored message
		notion.getForks.mockResolvedValue([
			{
				id: 'fork1',
				properties: {
					'What city are you in?': { rich_text: [{ text: { content: 'Delhi' } }] },
					'Status': { select: { name: 'Active' } },
					'Health Score': { number: 85 },
					'Points': { number: 150 },
				},
			},
		]);
		notion.getLeadDiscordId.mockReturnValue('lead_123');
		notion.getTeamMembers.mockResolvedValue(['tm1', 'tm2']);

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockChannel.send).toHaveBeenCalled();
		expect(db.run).toHaveBeenCalledWith(
			expect.stringContaining('INSERT OR REPLACE'),
			expect.arrayContaining([expect.stringContaining('fork_info_msg')])
		);
		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('New fork info dashboard posted'),
		}));
	});

	test('should edit existing message if it was stored previously', async () => {
		auth.isStaff.mockReturnValue(true);
		db.get.mockResolvedValue({
			val: JSON.stringify({ channelId: 'channel_456', messageId: 'existing_msg_999' }),
		});
		notion.getForks.mockResolvedValue([
			{
				id: 'fork1',
				properties: {
					'What city are you in?': { rich_text: [{ text: { content: 'Delhi' } }] },
					'Status': { select: { name: 'Active' } },
					'Health Score': { number: 85 },
					'Points': { number: 150 },
				},
			},
		]);
		notion.getLeadDiscordId.mockReturnValue('lead_123');
		notion.getTeamMembers.mockResolvedValue([]);

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockMessage.edit).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('Existing fork info dashboard updated'),
		}));
	});

	test('should handle refresh button click', async () => {
		auth.isStaff.mockReturnValue(true);
		notion.getForks.mockResolvedValue([
			{
				id: 'fork1',
				properties: {
					'What city are you in?': { rich_text: [{ text: { content: 'Delhi' } }] },
					'Status': { select: { name: 'Active' } },
					'Health Score': { number: 85 },
					'Points': { number: 150 },
				},
			},
		]);
		notion.getLeadDiscordId.mockReturnValue('lead_123');
		notion.getTeamMembers.mockResolvedValue([]);

		await handleButton(mockInteraction);

		expect(mockInteraction.deferUpdate).toHaveBeenCalled();
		expect(mockMessage.edit).toHaveBeenCalled();
	});

	test('should deny button refresh if member is not staff', async () => {
		auth.isStaff.mockReturnValue(false);

		await handleButton(mockInteraction);

		expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
			flags: [MessageFlags.Ephemeral],
			content: expect.stringContaining('permission'),
		}));
	});
});
