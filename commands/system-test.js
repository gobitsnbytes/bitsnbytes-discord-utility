const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const notion = require('../lib/notion');
const calcom = require('../lib/calcom');
const mailer = require('../lib/mailer');
const config = require('../config');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('system-test')
		.setDescription('Run connection diagnostics for all bot integrations.')
		.addStringOption(option => 
			option.setName('test-email')
				.setDescription('Send a real test email to this address to verify SMTP delivery')
				.setRequired(false)),

	async execute(interaction) {
		const allowedRoles = ['1506019068132462804', '1506323726223016149', '1480620981587279993'];
		const member = await interaction.guild.members.fetch(interaction.user.id);
		
		const isAuthorized = allowedRoles.some(roleId => member.roles.cache.has(roleId)) || member.permissions.has('Administrator');
		
		if (!isAuthorized) {
			const unauthorizedEmbed = new EmbedBuilder()
				.setTitle('Unauthorized Access')
				.setDescription('Your credentials do not grant access to run diagnostics.')
				.setColor(config.COLORS.error)
				.setFooter({ text: config.BRANDING.footerText });

			return await interaction.reply({ 
				embeds: [unauthorizedEmbed], 
				flags: [MessageFlags.Ephemeral] 
			});
		}

		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

		const results = {
			db: { status: '🟡 Pending', details: 'Skipped', time: 0 },
			notion: { status: '🟡 Pending', details: 'Skipped', time: 0 },
			calcom: { status: '🟡 Pending', details: 'Skipped', time: 0 },
			smtp: { status: '🟡 Pending', details: 'Skipped', time: 0 },
			emailDelivery: { status: '⚪ Not Tested', details: 'Provide test-email option to test' }
		};

		// 1. Test Database
		const dbStart = Date.now();
		try {
			const dbType = db.useTurso ? 'Turso Cloud' : 'Local SQLite';
			await db.get('SELECT 1 as val');
			results.db.status = '🟢 Connected';
			results.db.details = `Active (${dbType})`;
			results.db.time = Date.now() - dbStart;
		} catch (err) {
			results.db.status = '🔴 Connection Failed';
			results.db.details = err.message;
			results.db.time = Date.now() - dbStart;
		}

		// 2. Test Notion
		const notionStart = Date.now();
		try {
			if (!process.env.NOTION_TOKEN) {
				results.notion.status = '🔴 Missing Config';
				results.notion.details = 'NOTION_TOKEN not set';
			} else {
				// Query first page of forks to test API auth
				await notion.findForkByCity('test_probe_connection');
				results.notion.status = '🟢 Connected';
				results.notion.details = 'API Key valid';
				results.notion.time = Date.now() - notionStart;
			}
		} catch (err) {
			results.notion.status = '🔴 Connection Failed';
			results.notion.details = err.message;
			results.notion.time = Date.now() - notionStart;
		}

		// 3. Test Cal.com
		const calcomStart = Date.now();
		try {
			if (!process.env.CALCOM_API_KEY) {
				results.calcom.status = '🔴 Missing Config';
				results.calcom.details = 'CALCOM_API_KEY not set';
			} else {
				await calcom.getEventTypes();
				results.calcom.status = '🟢 Connected';
				results.calcom.details = 'API Key valid';
				results.calcom.time = Date.now() - calcomStart;
			}
		} catch (err) {
			results.calcom.status = '🔴 Connection Failed';
			results.calcom.details = err.message;
			results.calcom.time = Date.now() - calcomStart;
		}

		// 4. Test SMTP connection
		const smtpStart = Date.now();
		try {
			const check = await mailer.verifySMTP();
			if (check.success) {
				results.smtp.status = '🟢 Connected';
				results.smtp.details = `SMTP Handshake verified (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'})`;
				results.smtp.time = Date.now() - smtpStart;
			} else {
				results.smtp.status = '🔴 Connection Failed';
				results.smtp.details = check.error;
				results.smtp.time = Date.now() - smtpStart;
			}
		} catch (err) {
			results.smtp.status = '🔴 Connection Failed';
			results.smtp.details = err.message;
			results.smtp.time = Date.now() - smtpStart;
		}

		// 5. Test Email Delivery (Optional)
		const targetEmail = interaction.options.getString('test-email');
		if (targetEmail) {
			results.emailDelivery.status = '⏳ Sending...';
			const testBody = `
				<div style="background-color: #0D0D0D; color: #FFFFFF; font-family: sans-serif; padding: 30px; border-radius: 12px; border: 1px solid #1A1A1A; max-width: 600px; margin: 0 auto;">
					<h1 style="color: #00D2C4; border-bottom: 2px solid #1A1A1A; padding-bottom: 10px; margin-bottom: 20px;">Bits&Bytes Diagnostics</h1>
					<p>This is a live connection test email dispatched by your Discord bot.</p>
					<p>All SMTP connections are functioning correctly. Ready for production schedule dispatch!</p>
					<footer style="margin-top: 40px; font-size: 11px; color: #80848E; border-top: 1px solid #1A1A1A; padding-top: 10px;">
						Bits&Bytes Protocol // SMTP_MAILER_TEST
					</footer>
				</div>
			`;
			const sent = await mailer.sendMail({
				to: targetEmail,
				subject: 'Bits&Bytes System Test Diagnostics',
				html: testBody
			});
			if (sent) {
				results.emailDelivery.status = '🟢 Sent Successfully';
				results.emailDelivery.details = `Delivered to ${targetEmail}`;
			} else {
				results.emailDelivery.status = '🔴 Delivery Failed';
				results.emailDelivery.details = 'SMTP error - check logs';
			}
		}

		const embed = new EmbedBuilder()
			.setTitle('System Diagnostics Status')
			.setDescription('Live connectivity check for all bot databases and API integrations.')
			.addFields(
				{ name: '💾 Database Connection', value: `${results.db.status}\n▪ Latency: \`${results.db.time}ms\`\n▪ Details: ${results.db.details}`, inline: false },
				{ name: '📋 Notion Integration', value: `${results.notion.status}\n▪ Latency: \`${results.notion.time}ms\`\n▪ Details: ${results.notion.details}`, inline: false },
				{ name: '📆 Cal.com API Client', value: `${results.calcom.status}\n▪ Latency: \`${results.calcom.time}ms\`\n▪ Details: ${results.calcom.details}`, inline: false },
				{ name: '📧 SMTP Mail Server', value: `${results.smtp.status}\n▪ Latency: \`${results.smtp.time}ms\`\n▪ Details: ${results.smtp.details}`, inline: false },
				{ name: '📬 SMTP Delivery Test', value: `${results.emailDelivery.status}\n▪ Details: ${results.emailDelivery.details}`, inline: false }
			)
			.setColor(
				results.db.status.includes('🔴') || results.notion.status.includes('🔴') || results.calcom.status.includes('🔴') || results.smtp.status.includes('🔴')
					? config.COLORS.error
					: config.COLORS.success
			)
			.setTimestamp()
			.setFooter({ text: config.BRANDING.footerText });

		await interaction.editReply({ embeds: [embed] });
	}
};
