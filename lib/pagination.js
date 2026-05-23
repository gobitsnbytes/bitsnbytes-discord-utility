const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

async function paginate(interaction, pages, ephemeral = false, extraRow = null, timeout = 120000) {
	if (!interaction || !pages || pages.length === 0) return;

	// If there's only 1 page, just reply/editReply without pagination buttons
	if (pages.length === 1) {
		const components = extraRow ? [extraRow] : [];
		const payload = { embeds: [pages[0]], components };
		if (interaction.deferred || interaction.replied) {
			return await interaction.editReply(payload);
		} else {
			return await interaction.reply({ ...payload, ephemeral });
		}
	}

	let currentPage = 0;

	// Create buttons
	const getComponents = (index) => {
		const row = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('prev')
				.setLabel('◀ Prev')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(index === 0),
			new ButtonBuilder()
				.setCustomId('page_num')
				.setLabel(`Page ${index + 1} of ${pages.length}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId('next')
				.setLabel('Next ▶')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(index === pages.length - 1)
		);
		return extraRow ? [row, extraRow] : [row];
	};

	const payload = {
		embeds: [pages[currentPage]],
		components: getComponents(currentPage),
		fetchReply: true
	};

	let replyMessage;
	if (interaction.deferred || interaction.replied) {
		replyMessage = await interaction.editReply(payload);
	} else {
		replyMessage = await interaction.reply({ ...payload, ephemeral });
	}

	// Create a collector
	const collector = replyMessage.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: timeout
	});

	collector.on('collect', async (i) => {
		if (i.user.id !== interaction.user.id) {
			return await i.reply({ content: "You cannot control these pages.", ephemeral: true });
		}

		await i.deferUpdate();

		if (i.customId === 'prev') {
			if (currentPage > 0) currentPage--;
		} else if (i.customId === 'next') {
			if (currentPage < pages.length - 1) currentPage++;
		}

		await i.editReply({
			embeds: [pages[currentPage]],
			components: getComponents(currentPage)
		});
	});

	collector.on('end', async () => {
		// Disable pagination buttons when collector expires
		const disabledRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('prev')
				.setLabel('◀ Prev')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId('page_num')
				.setLabel(`Page ${currentPage + 1} of ${pages.length}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId('next')
				.setLabel('Next ▶')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true)
		);

		await interaction.editReply({
			components: extraRow ? [disabledRow, extraRow] : [disabledRow]
		}).catch(() => {});
	});
}

module.exports = { paginate };
