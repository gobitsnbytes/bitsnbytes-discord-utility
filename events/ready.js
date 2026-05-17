const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../lib/logger');
const notion = require('../lib/notion');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		logger.init(client); // Re-init to trigger flush now that we are ready
		logger.boot(`Logged in as ${client.user.tag}`);

		const rolesChannel = client.channels.cache.find(c => c.name === 'roles');
		if (rolesChannel) {
			logger.info(`Found #roles channel (${rolesChannel.id}). Starting setup...`);
			try {
				// Delete old bot messages concurrently
				const messages = await rolesChannel.messages.fetch({ limit: 20 });
				const botMessages = messages.filter(m => m.author.id === client.user.id);
				logger.info(`Found ${botMessages.size} old messages to purge in #roles.`);
				await Promise.all(botMessages.map(msg => msg.delete().catch(() => { })));

				const embed = new EmbedBuilder()
					.setTitle('🎯 Pick Your Interests')
					.setDescription('React below to get your interest roles!')
					.addFields(
						{ name: 'Interest Roles', value: '💻 dev  |  🎨 design  |  🔬 research  |  ⚙️ ops' }
					)
					.setColor('#5865F2');

				const sent = await rolesChannel.send({ embeds: [embed] });
				const emojis = ['💻', '🎨', '🔬', '⚙️'];

				logger.info('Posting reactions to #roles...');
				// React concurrently
				await Promise.all(emojis.map(emoji => sent.react(emoji).catch(() => { })));
				logger.info('Channel setup successful.');
			} catch (err) {
				logger.error('Roles setup failed', err);
			}
		} else {
			logger.warn('#roles channel not found.');
		}

		// ⌬ Self-Healing Channel Permission Synchronization for Active Forks
		logger.info('Starting self-healing channel permission synchronization...');
		(async () => {
			try {
				const forks = await notion.getForks();
				const activeForks = forks.filter(f => f.properties?.Status?.select?.name === 'Active');
				logger.info(`Found ${activeForks.length} active forks in registry database.`);

				for (const fork of activeForks) {
					const city = fork.properties?.['What city are you in?']?.rich_text?.[0]?.text?.content;
					const leadDiscordId = fork.properties?.['Discord ID']?.rich_text?.[0]?.text?.content;

					if (!city) continue;

					const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;

					for (const [, guild] of client.guilds.cache) {
						const cityChannel = guild.channels.cache.find(c => c.name === channelName);
						if (!cityChannel) continue;

						logger.info(`[SYNC] Synchronizing permissions for #${channelName} in guild: ${guild.name}`);

						const STAFF_ROLE_ID = '1480620981587279993';
						const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);

						// 1. Fetch team members to compute desired state
						let teamMembers = [];
						try {
							teamMembers = await notion.getTeamMembers(fork.id);
						} catch (teamErr) {
							logger.warn(`[SYNC] Could not fetch team members for fork ${city}: ${teamErr.message}`);
						}

						// 2. Compute the exact set of Discord IDs that should be in the channel
						const desiredIds = new Set();
						desiredIds.add(guild.roles.everyone.id);
						if (staffRole) desiredIds.add(staffRole.id);
						if (leadDiscordId) desiredIds.add(leadDiscordId);
						for (const member of teamMembers) {
							if (member.discordId && member.discordId !== leadDiscordId) {
								desiredIds.add(member.discordId);
							}
						}

						// 3. Diff against the channel's current permission overwrites
						const currentOverwrites = cityChannel.permissionOverwrites.cache;
						const currentIds = new Set(currentOverwrites.keys());

						let isMatch = desiredIds.size === currentIds.size;
						if (isMatch) {
							for (const id of desiredIds) {
								if (!currentIds.has(id)) {
									isMatch = false;
									break;
								}
							}
						}

						// 4. If they match perfectly, skip execution to save compute and API calls
						if (isMatch) {
							// Optionally log skipping if needed, but keeping it silent reduces log spam
							// logger.info(`[SYNC] Permissions already up to date for #${channelName}, skipping.`);
							continue;
						}

						// 5. Mismatch detected: rebuild permissions and fetch users to ensure they are still in server
						logger.info(`[SYNC] Mismatch detected for #${channelName}. Rebuilding permissions...`);

						const overwrites = [
							// Deny view for everyone
							{
								id: guild.roles.everyone.id,
								deny: [PermissionFlagsBits.ViewChannel],
								type: 0 // Role
							}
						];

						// Explicitly preserve Staff Role if it exists
						if (staffRole) {
							overwrites.push({
								id: staffRole.id,
								allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
								type: 0 // Role
							});
						}

						// Add lead overwrite
						if (leadDiscordId) {
							const leadMember = await guild.members.fetch(leadDiscordId).catch(() => null);
							if (leadMember) {
								overwrites.push({
									id: leadDiscordId,
									allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
									type: 1 // Member
								});
								logger.info(`[SYNC]   -> Granted Lead access to <@${leadDiscordId}>`);
							} else {
								logger.warn(`[SYNC]   -> Lead <@${leadDiscordId}> is not in the guild.`);
							}
						}

						// Add team member overwrites
						for (const member of teamMembers) {
							if (member.discordId && member.discordId !== leadDiscordId) {
								const teamMemberObj = await guild.members.fetch(member.discordId).catch(() => null);
								if (teamMemberObj) {
									overwrites.push({
										id: member.discordId,
										allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
										type: 1 // Member
									});
									logger.info(`[SYNC]   -> Granted Team Member access to <@${member.discordId}> (${member.role})`);
								} else {
									logger.warn(`[SYNC]   -> Team Member <@${member.discordId}> is not in the guild.`);
								}
							}
						}

						// Set the permission overwrites
						await cityChannel.permissionOverwrites.set(overwrites, 'Self-healing channel permission synchronization');
					}
				}
				logger.info('Self-healing permission synchronization complete.');
			} catch (err) {
				logger.error('Self-healing synchronization failed', err);
			}
		})();
	},
};
