const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { skipTrack } = require('../../utils/band/bandPlayer');

const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Überspringt den aktuellen Titel und spielt direkt den nächsten')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

async function execute(interaction) {
  const result = skipTrack();

  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: '⏭️ Titel übersprungen.', flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
