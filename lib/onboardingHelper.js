const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getForkLeadRole, getStaffRole } = require('./auth');
const config = require('../config');

async function setupOnboardingRoles(guild, member, city) {
	const forkLeadRole = getForkLeadRole(guild);
	if (!forkLeadRole) throw new Error('@fork-lead role not found in server.');

	let roleAssigned = true;
	// 1. Fork lead role
	try {
		await member.roles.add(forkLeadRole);
	} catch (roleErr) {
		console.error('[ONBOARDING_HELPER] Failed to assign fork-lead role:', roleErr.message);
		roleAssigned = false;
	}

	// 2. Contributor role
	const contributorRoleId = config.ROLE_IDS?.contributor || '1506019068132462804';
	let contributorRole = guild.roles.cache.get(contributorRoleId) || guild.roles.cache.find(r => r.name.toLowerCase() === 'contributor');
	if (!contributorRole) {
		try {
			contributorRole = await guild.roles.create({
				name: 'contributor',
				reason: 'Onboarding general contributor role creation'
			});
		} catch (err) {
			console.error('[ONBOARDING_HELPER] Failed to create contributor role:', err.message);
		}
	}
	if (contributorRole) {
		try {
			await member.roles.add(contributorRole);
		} catch (roleErr) {
			console.error('[ONBOARDING_HELPER] Failed to assign contributor role:', roleErr.message);
		}
	}

	// 3. Contributor city role
	let contributorCityRole = guild.roles.cache.find(r => r.name.toLowerCase() === `contributor-${city.toLowerCase()}`);
	if (!contributorCityRole) {
		try {
			contributorCityRole = await guild.roles.create({
				name: `contributor-${city}`,
				reason: 'Onboarding contributor city role creation'
			});
		} catch (err) {
			console.error(`[ONBOARDING_HELPER] Failed to create contributor city role "contributor-${city}":`, err.message);
		}
	}
	if (contributorCityRole) {
		try {
			await member.roles.add(contributorCityRole);
		} catch (roleErr) {
			console.error(`[ONBOARDING_HELPER] Failed to assign contributor city role (${city}):`, roleErr.message);
			roleAssigned = false;
		}
	}

	// 4. City role
	let cityRole = guild.roles.cache.find(r => r.name.toLowerCase() === city.toLowerCase());
	if (!cityRole) {
		try {
			cityRole = await guild.roles.create({
				name: city,
				reason: 'Onboarding city role creation'
			});
		} catch (err) {
			console.error(`[ONBOARDING_HELPER] Failed to create city role "${city}":`, err.message);
		}
	}
	if (cityRole) {
		try {
			await member.roles.add(cityRole);
		} catch (roleErr) {
			console.error(`[ONBOARDING_HELPER] Failed to assign city role (${city}):`, roleErr.message);
		}
	}

	return { roleAssigned, contributorCityRole };
}
async function setupOnboardingChannel(guild, user, city, contributorCityRole) {
	const category = guild.channels.cache.find(c => c.name === 'FORKS' && c.type === ChannelType.GuildCategory);
	const channelName = `gobitsnbytes-${city.toLowerCase().replace(/\s+/g, '-')}`;

	const contributorRoleId = config.ROLE_IDS?.contributor || '1506019068132462804';
	const contributorRole = guild.roles.cache.get(contributorRoleId) || guild.roles.cache.find(r => r.name.toLowerCase() === 'contributor');

	const overwrites = [
		{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
	];

	if (contributorRole) {
		overwrites.push({
			id: contributorRole.id,
			deny: [PermissionFlagsBits.ViewChannel],
			type: 0 // Role
		});
	}

	if (contributorCityRole) {
		overwrites.push({
			id: contributorCityRole.id,
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
				PermissionFlagsBits.EmbedLinks,
				PermissionFlagsBits.AttachFiles,
				PermissionFlagsBits.ReadMessageHistory
			]
		});
	}

	overwrites.push({
		id: user.id,
		allow: [
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessages,
			PermissionFlagsBits.EmbedLinks,
			PermissionFlagsBits.AttachFiles,
			PermissionFlagsBits.ReadMessageHistory,
			PermissionFlagsBits.ManageMessages,
			PermissionFlagsBits.ManageChannels,
			PermissionFlagsBits.ManageWebhooks
		]
	});

	const staffRole = getStaffRole(guild);
	if (staffRole) {
		overwrites.push({
			id: staffRole.id,
			allow: [
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
				PermissionFlagsBits.EmbedLinks,
				PermissionFlagsBits.AttachFiles,
				PermissionFlagsBits.ReadMessageHistory,
				PermissionFlagsBits.ManageMessages,
				PermissionFlagsBits.ManageWebhooks
			]
		});
	}

	let channel = guild.channels.cache.find(c => c.name === channelName);
	if (!channel) {
		try {
			channel = await guild.channels.create({
				name: channelName,
				type: ChannelType.GuildText,
				parent: category ? category.id : null,
				permissionOverwrites: overwrites
			});
		} catch (err) {
			// Race condition fallback: check if another thread created it
			console.log(`[ONBOARDING_HELPER] Channel creation race detected for ${channelName}, checking cache...`);
			channel = guild.channels.cache.find(c => c.name === channelName)
				|| await guild.channels.fetch().then(channels => channels.find(c => c.name === channelName)).catch(() => null);
			if (channel) {
				await channel.permissionOverwrites.set(overwrites).catch(() => {});
			} else {
				throw err;
			}
		}
	} else {
		await channel.permissionOverwrites.set(overwrites);
	}

	return { channel, channelName };
}

module.exports = {
	setupOnboardingRoles,
	setupOnboardingChannel
};
