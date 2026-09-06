const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { refreshVoteMessage } = require('../../utils/band/genreVoting');
const { refreshNowPlayingMessage } = require('../../utils/band/nowPlaying');

const data = new SlashCommandBuilder()
  .setName('refresh')
  .setDescription('Lädt Genre-Ordner neu, erneuert Abstimmungs-/Player-Nachrichten im Lounge-Channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const voteResult = await refreshVoteMessage(interaction.guild);
  if (!voteResult.ok) {
    await interaction.editReply(`❌ ${voteResult.message}`);
    return;
  }

  const playerResult = await refreshNowPlayingMessage(interaction.guild);
  if (!playerResult.ok) {
    await interaction.editReply(`❌ ${playerResult.message}`);
    return;
  }

  await interaction.editReply('🔄 Genre-Ordner neu geladen, Abstimmungs- und Player-Nachricht aktualisiert (fehlende Nachrichten wurden neu erstellt).');
}

module.exports = { data, execute };
