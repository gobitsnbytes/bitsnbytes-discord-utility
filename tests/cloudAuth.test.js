const { describe, test, expect, jest, beforeEach } = require('bun:test');
const { handleCloudApproveButton, handleCloudDenyButton, handleCloudDenySelect, processCloudDecision } = require('../lib/cloudAuth');

describe('Cloud Authorization & Anti-Abuse Flow Tests', () => {
	test('handleCloudApproveButton should display modal with default approval note', async () => {
		const mockInteraction = {
			showModal: jest.fn().mockResolvedValue(true),
		};

		await handleCloudApproveButton(mockInteraction);

		expect(mockInteraction.showModal).toHaveBeenCalledTimes(1);
		const modalData = mockInteraction.showModal.mock.calls[0][0];
		expect(modalData.data.custom_id).toBe('cloud_approve_modal');
		expect(modalData.data.title).toBe('Approve SparkCloud Access');
	});

	test('handleCloudDenyButton should display ephemeral select menu with pre-filled boilerplates', async () => {
		const mockInteraction = {
			reply: jest.fn().mockResolvedValue(true),
		};

		await handleCloudDenyButton(mockInteraction);

		expect(mockInteraction.reply).toHaveBeenCalledTimes(1);
		const replyData = mockInteraction.reply.mock.calls[0][0];
		expect(replyData.components.length).toBe(1);
		expect(replyData.ephemeral).toBe(true);
	});
});
