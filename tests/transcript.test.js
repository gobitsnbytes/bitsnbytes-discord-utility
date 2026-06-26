const config = require('../config');
const meetingsDb = require('../lib/meetingsDb');
const { VcTextCollector } = require('../lib/vcTextCollector');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbPath = require('../lib/db').dbPath;
const db = new sqlite3.Database(dbPath);

let originalColors, originalEmojis, originalBranding, originalTranscriptPrivacy, originalConsent;

beforeAll(() => {
	originalColors = { ...config.COLORS };
	originalEmojis = { ...config.EMOJIS };
	originalBranding = { ...config.BRANDING };
	originalTranscriptPrivacy = config.PRIVACY['meet-transcript'];
	originalConsent = { ...config.RECORDING.consent };

	Object.assign(config.COLORS, {
		primary: '#97192c',
		success: '#00FF95',
		warning: '#FFCC00',
		error: '#FF0055',
	});

	Object.assign(config.EMOJIS, {
		error: '❌',
	});

	config.BRANDING.footerText = 'TEST_FOOTER';
	config.PRIVACY['meet-transcript'] = true;
	Object.assign(config.RECORDING.consent, {
		audioEnglish: './assets/english.mp3',
		audioHindi: './assets/hindi.mp3',
		textEnglish: 'Test English Consent',
		textHindi: 'Test Hindi Consent'
	});
});

afterAll(() => {
	Object.assign(config.COLORS, originalColors);
	Object.assign(config.EMOJIS, originalEmojis);
	Object.assign(config.BRANDING, originalBranding);
	config.PRIVACY['meet-transcript'] = originalTranscriptPrivacy;
	config.RECORDING.consent = originalConsent;
});

describe('Meeting Transcripts Database Tests', () => {
	const testMeetingId = 'meet_transcript_test_123';
	const testUserId = 'user_attendee_123';

	beforeAll(async () => {
		await meetingsDb.initPromise;
		await new Promise((resolve) => {
			db.serialize(() => {
				db.run("DELETE FROM meeting_transcripts WHERE meeting_id = ?", [testMeetingId], () => {
					db.run("DELETE FROM meeting_attendees WHERE meeting_id = ?", [testMeetingId], () => {
						db.run("DELETE FROM meetings WHERE id = ?", [testMeetingId], resolve);
					});
				});
			});
		});
	});

	afterAll(async () => {
		await new Promise((resolve) => {
			db.serialize(() => {
				db.run("DELETE FROM meeting_transcripts WHERE meeting_id = ?", [testMeetingId], () => {
					db.run("DELETE FROM meeting_attendees WHERE meeting_id = ?", [testMeetingId], () => {
						db.run("DELETE FROM meetings WHERE id = ?", [testMeetingId], resolve);
					});
				});
			});
		});
	});

	test('should save and retrieve meeting transcripts', async () => {
		// 1. Create a parent meeting
		const meeting = {
			id: testMeetingId,
			title: 'Transcript Test Meeting',
			scheduledTime: Date.now(),
			locationType: 'discord_vc',
			creatorId: 'user_creator_id'
		};
		await meetingsDb.createMeeting(meeting);
		await meetingsDb.addAttendee(testMeetingId, 'user', testUserId);

		// 2. Verify recording status update
		await meetingsDb.updateRecordingStatus(testMeetingId, 'processing');
		const initialMeeting = await meetingsDb.getMeeting(testMeetingId);
		expect(initialMeeting.recording_status).toBe('processing');

		// 3. Save transcript
		const transcriptData = {
			summary: 'This is a test summary.',
			keyDecisions: ['Decision A', 'Decision B'],
			actionItems: [{ assignee: 'akshat', task: 'Review tests' }],
			fullTranscript: 'akshat: hello. other: hi.',
			timestampedTranscript: '[00:01] akshat: hello. [00:03] other: hi.',
			vcTextMessages: [{ author: 'akshat', content: '!hindi', timestamp: Date.now() }],
			durationSeconds: 120,
			speakerCount: 2
		};

		await meetingsDb.saveTranscript(testMeetingId, transcriptData);

		// 4. Retrieve transcript
		const retrieved = await meetingsDb.getTranscript(testMeetingId);
		expect(retrieved).not.toBeNull();
		expect(retrieved.meeting_id).toBe(testMeetingId);
		expect(retrieved.summary).toBe('This is a test summary.');
		expect(retrieved.key_decisions).toEqual(['Decision A', 'Decision B']);
		expect(retrieved.action_items).toEqual([{ assignee: 'akshat', task: 'Review tests' }]);
		expect(retrieved.full_transcript).toBe('akshat: hello. other: hi.');
		expect(retrieved.timestamped_transcript).toBe('[00:01] akshat: hello. [00:03] other: hi.');
		expect(retrieved.audio_duration_seconds).toBe(120);
		expect(retrieved.speaker_count).toBe(2);

		// 5. Test attendee check
		const isAttendee = await meetingsDb.isUserAttendee(testMeetingId, testUserId);
		expect(isAttendee).toBe(true);

		const isNotAttendee = await meetingsDb.isUserAttendee(testMeetingId, 'other_random_user');
		expect(isNotAttendee).toBe(false);

		// 6. Test retrieval lists
		const userTranscripts = await meetingsDb.getTranscriptsForUser(testUserId, { limit: 5 });
		expect(userTranscripts.length).toBeGreaterThan(0);
		expect(userTranscripts[0].title).toBe('Transcript Test Meeting');

		const allTranscripts = await meetingsDb.getAllTranscripts({ limit: 5 });
		expect(allTranscripts.length).toBeGreaterThan(0);

		// 7. Delete transcript
		await meetingsDb.deleteTranscript(testMeetingId);
		const deleted = await meetingsDb.getTranscript(testMeetingId);
		expect(deleted).toBeNull();
	});
});

describe('VcTextCollector Tests', () => {
	let mockClient;
	let mockMessage;
	let eventCallbacks;

	beforeEach(() => {
		eventCallbacks = {};
		mockClient = {
			on: jest.fn().mockImplementation((event, callback) => {
				eventCallbacks[event] = callback;
			}),
			removeListener: jest.fn()
		};

		mockMessage = {
			channel: { id: 'vc_channel_123' },
			author: { bot: false, id: 'user_123', displayName: 'akshat', username: 'akshat' },
			member: { displayName: 'akshat' },
			content: 'Hello World',
			createdTimestamp: 1716600000000,
			attachments: new Map(),
			reply: jest.fn().mockResolvedValue(true)
		};
	});

	test('should capture messages in the correct channel', async () => {
		const collector = new VcTextCollector('vc_channel_123', mockClient);
		expect(mockClient.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));

		// Emit message
		await eventCallbacks['messageCreate'](mockMessage);

		// Emit message from a different channel
		const wrongMessage = { ...mockMessage, channel: { id: 'different_channel' } };
		await eventCallbacks['messageCreate'](wrongMessage);

		// Emit message from a bot
		const botMessage = { ...mockMessage, author: { bot: true } };
		await eventCallbacks['messageCreate'](botMessage);

		const collected = collector.stop();
		expect(collected).toHaveLength(1);
		expect(collected[0].content).toBe('Hello World');
		expect(collected[0].author).toBe('akshat');
	});

	test('should intercept !hindi command and trigger onCommand callback', async () => {
		const onCommandMock = jest.fn();
		const collector = new VcTextCollector('vc_channel_123', mockClient, onCommandMock);

		mockMessage.content = ' !hindi '; // Test trim and case insensitivity
		await eventCallbacks['messageCreate'](mockMessage);

		expect(onCommandMock).toHaveBeenCalledWith('hindi');
		expect(mockMessage.reply).toHaveBeenCalled();

		const collected = collector.stop();
		// !hindi is now filtered out — it's an operational command, not meeting content
		expect(collected).toHaveLength(0);
	});
});

