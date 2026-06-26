/**
 * Unit tests for commands/report-view.js
 */

const notion = require('../lib/notion');
const auth = require('../lib/auth');

// Set up spy mocks
jest.spyOn(auth, 'isAuthorizedForCity').mockImplementation(() => {});

const { execute } = require('../commands/report-view');
const { MessageFlags } = require('discord.js');

describe('Report View Command Tests', () => {
	let mockInteraction;

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();

		jest.spyOn(notion, 'findForkByCity').mockImplementation(() => {});
		jest.spyOn(notion, 'getReports').mockImplementation(() => {});

		mockInteraction = {
			user: { id: 'user_123' },
			guild: {},
			options: {
				getString: jest.fn(),
				getInteger: jest.fn(),
			},
			deferReply: jest.fn().mockResolvedValue(true),
			editReply: jest.fn().mockResolvedValue(true),
		};
	});

	test('should deny access if member is not authorized for city', async () => {
		mockInteraction.options.getString.mockReturnValue('noida');
		auth.isAuthorizedForCity.mockResolvedValue(false);

		await execute(mockInteraction);

		expect(mockInteraction.deferReply).toHaveBeenCalled();
		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			embeds: expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						title: expect.stringContaining('PROTOCOL_UNAUTHORIZED'),
					})
				})
			])
		}));
	});

	test('should return error if fork is not found', async () => {
		mockInteraction.options.getString.mockReturnValue('noida');
		auth.isAuthorizedForCity.mockResolvedValue(true);
		notion.findForkByCity.mockResolvedValue(null);

		await execute(mockInteraction);

		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			content: expect.stringContaining('Fork not found'),
		}));
	});

	test('should return empty message if no reports found', async () => {
		mockInteraction.options.getString.mockReturnValue('noida');
		auth.isAuthorizedForCity.mockResolvedValue(true);
		notion.findForkByCity.mockResolvedValue({ id: 'fork_noida' });
		notion.getReports.mockResolvedValue([]);

		await execute(mockInteraction);

		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			embeds: expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						description: expect.stringContaining('No reports have been submitted'),
					})
				})
			])
		}));
	});

	test('should show details of reports if they exist', async () => {
		mockInteraction.options.getString.mockReturnValue('noida');
		mockInteraction.options.getInteger.mockReturnValue(5);
		auth.isAuthorizedForCity.mockResolvedValue(true);
		notion.findForkByCity.mockResolvedValue({ id: 'fork_noida' });
		notion.getReports.mockResolvedValue([
			{
				id: 'rep_1',
				type: 'monthly',
				submittedDate: '2026-05-29',
				attachmentUrl: 'http://test.com/file.pdf',
				notes: 'Test monthly report notes.',
				status: 'late',
			},
			{
				id: 'rep_2',
				type: 'bi-weekly',
				submittedDate: '2026-05-15',
				attachmentUrl: null,
				notes: 'Test bi-weekly report notes.',
				status: 'on-time',
			}
		]);

		await execute(mockInteraction);

		expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
			embeds: expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						title: expect.stringContaining('REPORT_DETAILS // NOIDA'),
						fields: expect.arrayContaining([
							expect.objectContaining({
								name: expect.stringContaining('Report #2 (MONTHLY)'),
								value: expect.stringContaining('Test monthly report notes.'),
							}),
							expect.objectContaining({
								name: expect.stringContaining('Report #1 (BI-WEEKLY)'),
								value: expect.stringContaining('Test bi-weekly report notes.'),
							}),
						]),
					})
				})
			])
		}));
	});
});
