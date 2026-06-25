// Mock nodemailer
jest.mock('nodemailer', () => ({
	createTransport: jest.fn().mockReturnValue({
		sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' })
	})
}));

const icsGenerator = require('../lib/icsGenerator');
const emailTemplates = require('../lib/emailTemplates');
const mailer = require('../lib/mailer');
const calcom = require('../lib/calcom');
const calcomWebhook = require('../lib/calcomWebhook');
const meetingsDb = require('../lib/meetingsDb');

// Mock fetch for Cal.com API
global.fetch = jest.fn();

describe('ICS Generator Tests', () => {
	test('should generate valid iCalendar content', () => {
		const meeting = {
			id: 'meet_test_999',
			title: 'Code Review Meeting',
			description: 'Going over the calcom integration specs',
			scheduled_time: Date.parse('2026-06-01T10:00:00.000Z'),
			end_time: Date.parse('2026-06-01T11:00:00.000Z'),
			location_type: 'discord_vc',
			temp_channel_id: '1234567890'
		};

		const icsStr = icsGenerator.generateICS(meeting, 'guild_123');
		expect(icsStr).toContain('BEGIN:VCALENDAR');
		expect(icsStr).toContain('SUMMARY:Code Review Meeting');
		expect(icsStr).toContain('DESCRIPTION:Going over the calcom integration specs');
		expect(icsStr).toContain('LOCATION:Discord VC (https://discord.com/channels/guild_123/1234567890)');
		expect(icsStr).toContain('END:VCALENDAR');
	});
});

describe('Email Templates Tests', () => {
	test('should produce HTML containing meeting details', () => {
		const meeting = {
			title: 'Sprint Planning',
			description: 'Planning out the next sprint details.'
		};
		const html = emailTemplates.getInviteTemplate(meeting, 'June 1, 2026 at 3:30 PM IST', 'https://discord.gg/test');
		expect(html).toContain('Sprint Planning');
		expect(html).toContain('Planning out the next sprint details.');
		expect(html).toContain('June 1, 2026 at 3:30 PM IST');
		expect(html).toContain('Join Meeting');
	});
});

describe('Cal.com Client Tests', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		process.env.CALCOM_API_KEY = 'cal_test_key_123';
	});

	test('getEventTypes should return mapped array', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: jest.fn().mockResolvedValue({
				data: {
					eventTypes: [{ id: 456, slug: 'test-event' }]
				}
			})
		});

		const types = await calcom.getEventTypes();
		expect(types).toHaveLength(1);
		expect(types[0].id).toBe(456);
	});

	test('createBooking should send POST request', async () => {
		global.fetch.mockResolvedValueOnce({
			ok: true,
			json: jest.fn().mockResolvedValue({
				data: { id: 789, uid: 'booking-uid-789' }
			})
		});

		const result = await calcom.createBooking({ eventTypeId: 123 });
		expect(result.uid).toBe('booking-uid-789');
	});
});

describe('Mailer RSVP Alternatives', () => {
	beforeEach(() => {
		process.env.SMTP_HOST = 'smtp.test.com';
		process.env.SMTP_USER = 'user';
		process.env.SMTP_PASS = 'pass';
	});

	test('should include alternatives array in mailOptions when icsContent is provided', async () => {
		const nodemailer = require('nodemailer');
		const transporterInstance = nodemailer.createTransport();
		
		await mailer.sendMail({
			to: 'test@example.com',
			subject: 'Test Meeting RSVP',
			html: '<p>Invite</p>',
			icsContent: 'BEGIN:VCALENDAR...',
			attachmentName: 'invite.ics'
		});

		expect(transporterInstance.sendMail).toHaveBeenCalled();
		const mailOptions = transporterInstance.sendMail.mock.calls[0][0];
		expect(mailOptions.attachments).toBeDefined();
		expect(mailOptions.alternatives).toBeDefined();
		expect(mailOptions.alternatives[0].contentType).toBe('text/calendar; charset=utf-8; method=REQUEST');
		expect(mailOptions.alternatives[0].content).toBe('BEGIN:VCALENDAR...');
	});
});
