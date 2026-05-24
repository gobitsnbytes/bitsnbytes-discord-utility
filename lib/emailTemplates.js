/**
 * 📧 BITS&BYTES PROTOCOL - EMAIL HTML TEMPLATES
 * Version: 1.0.0
 * Purpose: Premium dark-themed HTML emails for Bits&Bytes meeting system
 */

const baseStyle = `
	body {
		background-color: #0D0D0D;
		color: #E0E0E0;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
		margin: 0;
		padding: 0;
		-webkit-font-smoothing: antialiased;
	}
	.container {
		max-width: 600px;
		margin: 40px auto;
		background-color: #121212;
		border: 1px solid #1A1A1A;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
	}
	.header {
		background-color: #1A1A1A;
		padding: 24px;
		text-align: center;
		border-bottom: 2px solid #00F2FF;
	}
	.header h1 {
		color: #00F2FF;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: 2px;
		margin: 0;
		text-transform: uppercase;
		font-family: 'Courier New', Courier, monospace;
	}
	.content {
		padding: 32px 24px;
	}
	.card {
		background-color: #1A1A1A;
		border: 1px solid #262626;
		border-radius: 6px;
		padding: 20px;
		margin-bottom: 24px;
	}
	.card-title {
		font-size: 18px;
		font-weight: 600;
		color: #FFFFFF;
		margin-top: 0;
		margin-bottom: 12px;
	}
	.card-meta {
		font-size: 14px;
		color: #888888;
		margin-bottom: 20px;
		line-height: 1.5;
	}
	.detail-row {
		margin-bottom: 12px;
		font-size: 14px;
	}
	.detail-label {
		color: #00F2FF;
		font-weight: 600;
		text-transform: uppercase;
		font-size: 12px;
		letter-spacing: 1px;
		display: inline-block;
		width: 120px;
	}
	.detail-value {
		color: #FFFFFF;
	}
	.button-container {
		text-align: center;
		margin-top: 28px;
		margin-bottom: 16px;
	}
	.btn {
		background-color: #00F2FF;
		color: #000000 !important;
		text-decoration: none;
		padding: 12px 28px;
		font-weight: 700;
		border-radius: 4px;
		font-size: 14px;
		display: inline-block;
		text-transform: uppercase;
		letter-spacing: 1px;
		transition: background-color 0.2s;
	}
	.btn:hover {
		background-color: #00CCDD;
	}
	.footer {
		background-color: #1A1A1A;
		padding: 16px 24px;
		text-align: center;
		font-size: 11px;
		color: #666666;
		border-top: 1px solid #262626;
		letter-spacing: 1px;
	}
	.footer a {
		color: #00F2FF;
		text-decoration: none;
	}
`;

function getInviteTemplate(meeting, formattedTime, locationLink) {
	const joinButton = locationLink
		? `<div class="button-container">
				<a href="${locationLink}" class="btn">Join Meeting</a>
		   </div>`
		: '';

	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Bits&Bytes Meeting Invite</title>
		<style>${baseStyle}</style>
	</head>
	<body>
		<div class="container">
			<div class="header">
				<img src="https://gobitsnbytes.org/logo" alt="Bits&Bytes Logo" style="height: 48px; max-height: 48px; margin-bottom: 12px;"><br>
				<h1>MEET_INVITE</h1>
			</div>
			<div class="content">
				<div class="card">
					<h2 class="card-title">${meeting.title}</h2>
					<div class="card-meta">${meeting.description || 'No agenda provided.'}</div>
					
					<div class="detail-row">
						<span class="detail-label">DATE & TIME</span>
						<span class="detail-value">${formattedTime}</span>
					</div>
					
					<div class="detail-row">
						<span class="detail-label">LOCATION</span>
						<span class="detail-value">${meeting.location_type === 'discord_vc' ? 'Discord Temporary VC' : (meeting.location_details || 'External Link')}</span>
					</div>
				</div>
				
				<p style="font-size: 14px; color: #AAAAAA; line-height: 1.6;">
					You have been invited to this meeting. We have attached an <strong>iCalendar (.ics)</strong> entry to this email so you can add it directly to your calendar of choice.
				</p>
				
				${joinButton}
			</div>
			<div class="footer">
				BITS&BYTES PROTOCOL // SYSTEM_AUTO_DISPATCH<br>
				Need help? Reach out on our <a href="https://discord.gg/gobitsnbytes">Discord Server</a>.
			</div>
		</div>
	</body>
	</html>
	`;
}

function getReminderTemplate(meeting, formattedTime, locationLink, timeLabel) {
	const joinButton = locationLink
		? `<div class="button-container">
				<a href="${locationLink}" class="btn">Join Channel</a>
		   </div>`
		: '';

	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Bits&Bytes Meeting Reminder</title>
		<style>${baseStyle}</style>
	</head>
	<body>
		<div class="container">
			<div class="header" style="border-bottom: 2px solid #FFCC00;">
				<img src="https://gobitsnbytes.org/logo" alt="Bits&Bytes Logo" style="height: 48px; max-height: 48px; margin-bottom: 12px;"><br>
				<h1 style="color: #FFCC00;">MEET_REMINDER</h1>
			</div>
			<div class="content">
				<p style="font-size: 15px; color: #FFFFFF; font-weight: 600; margin-bottom: 20px;">
					Starting in ${timeLabel}:
				</p>
				<div class="card">
					<h2 class="card-title">${meeting.title}</h2>
					<div class="card-meta">${meeting.description || 'No agenda provided.'}</div>
					
					<div class="detail-row">
						<span class="detail-label">START TIME</span>
						<span class="detail-value">${formattedTime}</span>
					</div>
					
					<div class="detail-row">
						<span class="detail-label">LOCATION</span>
						<span class="detail-value">${meeting.location_type === 'discord_vc' ? 'Discord Temporary VC' : (meeting.location_details || 'External Link')}</span>
					</div>
				</div>
				
				${joinButton}
			</div>
			<div class="footer">
				BITS&BYTES PROTOCOL // SYSTEM_AUTO_DISPATCH
			</div>
		</div>
	</body>
	</html>
	`;
}

function getCancellationTemplate(meeting, formattedTime) {
	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Bits&Bytes Meeting Cancelled</title>
		<style>${baseStyle}</style>
	</head>
	<body>
		<div class="container">
			<div class="header" style="border-bottom: 2px solid #FF0055;">
				<img src="https://gobitsnbytes.org/logo" alt="Bits&Bytes Logo" style="height: 48px; max-height: 48px; margin-bottom: 12px;"><br>
				<h1 style="color: #FF0055;">MEET_CANCELLED</h1>
			</div>
			<div class="content">
				<p style="font-size: 15px; color: #FFFFFF; font-weight: 600; margin-bottom: 20px;">
					The following meeting has been cancelled:
				</p>
				<div class="card">
					<h2 class="card-title" style="text-decoration: line-through; color: #888888;">${meeting.title}</h2>
					
					<div class="detail-row">
						<span class="detail-label" style="color: #888888;">ORIGINAL DATE</span>
						<span class="detail-value" style="color: #888888;">${formattedTime}</span>
					</div>
				</div>
				<p style="font-size: 14px; color: #AAAAAA; line-height: 1.6;">
					This event has been removed from the schedule. Please update your calendar entries accordingly.
				</p>
			</div>
			<div class="footer">
				BITS&BYTES PROTOCOL // SYSTEM_AUTO_DISPATCH
			</div>
		</div>
	</body>
	</html>
	`;
}

module.exports = {
	getInviteTemplate,
	getReminderTemplate,
	getCancellationTemplate
};
