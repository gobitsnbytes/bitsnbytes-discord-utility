/**
 * 📧 BITS&BYTES PROTOCOL - SMTP MAILER ENGINE
 * Version: 1.0.0
 * Purpose: Centralized SMTP client with nodemailer
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');
const { generateICS } = require('./icsGenerator');
const { getInviteTemplate, getReminderTemplate, getCancellationTemplate } = require('./emailTemplates');

let transporter = null;

function getTransporter() {
	if (transporter) return transporter;

	const host = process.env.SMTP_HOST;
	const port = parseInt(process.env.SMTP_PORT || '587', 10);
	const user = process.env.SMTP_USER;
	const pass = process.env.SMTP_PASS;

	if (!host || !user || !pass) {
		logger.warn('[MAILER] SMTP credentials not fully configured in environment.');
		return null;
	}

	try {
		transporter = nodemailer.createTransport({
			host,
			port,
			secure: port === 465, // True for 465, false for 587/other
			auth: {
				user,
				pass
			},
			tls: {
				rejectUnauthorized: false // Ignore self-signed certificates if any
			}
		});
		return transporter;
	} catch (error) {
		logger.error('[MAILER] Failed to create SMTP transporter', error);
		return null;
	}
}

/**
 * Low-level send mail method
 */
async function sendMail({ to, subject, html, icsContent, attachmentName = 'invite.ics' }) {
	const client = getTransporter();
	if (!client) {
		logger.warn(`[MAILER] Cannot send mail: SMTP transporter not initialized.`);
		return false;
	}

	const from = process.env.SMTP_FROM || 'hello@gobitsnbytes.org';
	const mailOptions = {
		from,
		to: Array.isArray(to) ? to.join(', ') : to,
		subject,
		html
	};

	if (icsContent) {
		mailOptions.attachments = [
			{
				filename: attachmentName,
				content: icsContent,
				contentType: 'text/calendar; charset=utf-8; method=REQUEST'
			}
		];
		mailOptions.alternatives = [
			{
				contentType: 'text/calendar; charset=utf-8; method=REQUEST',
				content: icsContent
			}
		];
	}

	try {
		const info = await client.sendMail(mailOptions);
		logger.info(`[MAILER] Email sent: ${info.messageId} to ${mailOptions.to}`);
		return true;
	} catch (error) {
		logger.error(`[MAILER] Failed to send email to ${mailOptions.to}`, error);
		return false;
	}
}

/**
 * Dispatch meeting invitation emails
 */
async function sendMeetingInvite(emails, meeting, formattedTime, locationLink = '', guildId = '') {
	if (!emails || emails.length === 0) return;
	
	const html = getInviteTemplate(meeting, formattedTime, locationLink);
	const icsContent = generateICS(meeting, guildId);

	await sendMail({
		to: emails,
		subject: `⚡ Meeting Invitation: ${meeting.title}`,
		html,
		icsContent,
		attachmentName: 'invite.ics'
	});
}

/**
 * Dispatch meeting reminder emails
 */
async function sendMeetingReminder(emails, meeting, formattedTime, locationLink = '', timeLabel = '30 minutes') {
	if (!emails || emails.length === 0) return;

	const html = getReminderTemplate(meeting, formattedTime, locationLink, timeLabel);
	
	await sendMail({
		to: emails,
		subject: `⚠️ Reminder: [${timeLabel.toUpperCase()}] ${meeting.title}`,
		html
	});
}

/**
 * Dispatch meeting cancellation emails
 */
async function sendMeetingCancellation(emails, meeting, formattedTime) {
	if (!emails || emails.length === 0) return;

	const html = getCancellationTemplate(meeting, formattedTime);

	await sendMail({
		to: emails,
		subject: `❌ Cancelled: ${meeting.title}`,
		html
	});
}

/**
 * Dispatch meeting reschedule notification emails
 */
async function sendMeetingReschedule(emails, meeting, oldTime, newTime, reason, rescheduledByName, locationLink, guildId) {
	if (!emails || emails.length === 0) return;

	const { getRescheduleTemplate } = require('./emailTemplates');
	const html = getRescheduleTemplate(meeting, oldTime, newTime, reason, rescheduledByName);
	const icsContent = generateICS(meeting, guildId);

	await sendMail({
		to: emails,
		subject: `🔄 Rescheduled: ${meeting.title}`,
		html,
		icsContent,
		attachmentName: 'updated_invite.ics'
	});
}

async function verifySMTP() {
	const client = getTransporter();
	if (!client) return { success: false, error: 'SMTP transporter not configured' };
	try {
		await client.verify();
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
}

module.exports = {
	sendMail,
	sendMeetingInvite,
	sendMeetingReminder,
	sendMeetingCancellation,
	sendMeetingReschedule,
	verifySMTP
};
