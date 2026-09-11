const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { forceRejoin } = require('../../utils/band/bandPlayer');

const data = new SlashCommandBuilder()
  .setName('rejoin')
  .setDescription('Verbindet die Band neu mit dem konfigurierten Voice-/Stage-Channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await forceRejoin(interaction.client);

  if (!result.ok) {
    await interaction.editReply(`❌ ${result.message}`);
    return;
  }

  await interaction.editReply('🔁 Neu verbunden.');
}

module.exports = { data, execute };
