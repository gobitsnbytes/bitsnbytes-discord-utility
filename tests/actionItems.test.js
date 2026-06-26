const config = require('../config');
const meetingsDb = require('../lib/meetingsDb');
const interactionCreate = require('../events/interactionCreate');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = require('../lib/db').dbPath;
const db = new sqlite3.Database(dbPath);

let originalColors, originalEmojis, originalBranding;

beforeAll(() => {
	originalColors = { ...config.COLORS };
	originalEmojis = { ...config.EMOJIS };
	originalBranding = { ...config.BRANDING };

	Object.assign(config.COLORS, {
		primary: '#97192c',
		secondary: '#120f0a',
		success: '#23a55a',
		warning: '#ffae24',
		error: '#f04438',
		neutral: '#ff7a1b',
	});

	Object.assign(config.EMOJIS, {
		success: '🟢',
		error: '🔴',
	});

	config.BRANDING.footerText = 'TEST_FOOTER';
});

afterAll(() => {
	Object.assign(config.COLORS, originalColors);
	Object.assign(config.EMOJIS, originalEmojis);
	Object.assign(config.BRANDING, originalBranding);
});

describe('Action Items Database and Interaction Tests', () => {
	const testMeetingId = 'meet_action_item_test_123';
	const testUserId = 'discord_user_12345';
	let createdActionItemId;

	beforeAll(async () => {
		// Wait for meetingsDb migrations to complete
		await meetingsDb.initPromise;

		await new Promise((resolve) => {
			db.serialize(() => {
				db.run("DELETE FROM meetings", () => {
					db.run("DELETE FROM action_items", resolve);
				});
			});
		});

		// Create a test meeting first to satisfy foreign key constraint
		await meetingsDb.createMeeting({
			id: testMeetingId,
			title: 'Action Item Meeting',
			description: 'Test meeting for action items',
			scheduledTime: Date.now() + 60000,
			locationType: 'discord_vc',
			creatorId: 'creator_123'
		});
	});

	test('should create, retrieve and update action items in the DB', async () => {
		createdActionItemId = await meetingsDb.createActionItem(
			testMeetingId,
			'Adithya',
			testUserId,
			'Complete the action item tracker',
			'2026-06-05'
		);

		expect(createdActionItemId).toBeGreaterThan(0);

		// Retrieve
		const actionItem = await meetingsDb.getActionItem(createdActionItemId);
		expect(actionItem).not.toBeNull();
		expect(actionItem.meeting_id).toBe(testMeetingId);
		expect(actionItem.assignee).toBe('Adithya');
		expect(actionItem.discord_id).toBe(testUserId);
		expect(actionItem.task).toBe('Complete the action item tracker');
		expect(actionItem.deadline).toBe('2026-06-05');
		expect(actionItem.status).toBe('pending');

		// Get for user
		const userItems = await meetingsDb.getActionItemsForUser(testUserId, 'pending');
		expect(userItems.length).toBe(1);
		expect(userItems[0].id).toBe(createdActionItemId);

		// Update status
		await meetingsDb.updateActionItemStatus(createdActionItemId, 'completed');
		const updatedItem = await meetingsDb.getActionItem(createdActionItemId);
		expect(updatedItem.status).toBe('completed');
	});

	test('should handle complete action item button interaction successfully', async () => {
		// Reset status to pending
		await meetingsDb.updateActionItemStatus(createdActionItemId, 'pending');

		const mockInteraction = {
			isChatInputCommand: () => false,
			isAutocomplete: () => false,
			isModalSubmit: () => false,
			isButton: () => true,
			customId: `action_item_complete_${createdActionItemId}`,
			user: { id: testUserId },
			deferUpdate: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			followUp: jest.fn().mockResolvedValue(true),
			message: {
				embeds: [{
					title: '📋 ACTION_ITEM_ASSIGNED',
					description: 'You have been assigned a new task from the meeting "Action Item Meeting".',
					data: {
						title: '📋 ACTION_ITEM_ASSIGNED',
						description: 'You have been assigned a new task from the meeting "Action Item Meeting".'
					}
				}]
			}
		};

		await interactionCreate.execute(mockInteraction);

		expect(mockInteraction.deferUpdate).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalled();
		
		const updatedItem = await meetingsDb.getActionItem(createdActionItemId);
		expect(updatedItem.status).toBe('completed');
	});

	test('should handle dismiss action item button interaction successfully', async () => {
		// Reset status to pending
		await meetingsDb.updateActionItemStatus(createdActionItemId, 'pending');

		const mockInteraction = {
			isChatInputCommand: () => false,
			isAutocomplete: () => false,
			isModalSubmit: () => false,
			isButton: () => true,
			customId: `action_item_dismiss_${createdActionItemId}`,
			user: { id: testUserId },
			deferUpdate: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			followUp: jest.fn().mockResolvedValue(true),
			message: {
				embeds: [{
					title: '📋 ACTION_ITEM_ASSIGNED',
					description: 'You have been assigned a new task from the meeting "Action Item Meeting".',
					data: {
						title: '📋 ACTION_ITEM_ASSIGNED',
						description: 'You have been assigned a new task from the meeting "Action Item Meeting".'
					}
				}]
			}
		};

		await interactionCreate.execute(mockInteraction);

		expect(mockInteraction.deferUpdate).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalled();
		
		const updatedItem = await meetingsDb.getActionItem(createdActionItemId);
		expect(updatedItem.status).toBe('dismissed');
	});

	test('should reject interaction if user is unauthorized', async () => {
		const mockInteraction = {
			isChatInputCommand: () => false,
			isAutocomplete: () => false,
			isModalSubmit: () => false,
			isButton: () => true,
			customId: `action_item_complete_${createdActionItemId}`,
			user: { id: 'unauthorized_user_id' },
			deferUpdate: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
			followUp: jest.fn().mockResolvedValue(true),
			message: {
				embeds: [{
					title: '📋 ACTION_ITEM_ASSIGNED',
					description: 'You have been assigned a new task.',
					data: {
						title: '📋 ACTION_ITEM_ASSIGNED',
						description: 'You have been assigned a new task.'
					}
				}]
			}
		};

		await interactionCreate.execute(mockInteraction);

		expect(mockInteraction.deferUpdate).toHaveBeenCalled();
		expect(mockInteraction.followUp).toHaveBeenCalledWith(expect.objectContaining({
			content: '❌ You are not authorized to update this action item.'
		}));
	});
});
