const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getCurrentTrack } = require('../../utils/band/bandPlayer');
const { getCredit } = require('../../storage/musicCredits');

// Bewusst KEIN setDefaultMemberPermissions - dieser Befehl steht allen Nutzern offen.
const data = new SlashCommandBuilder()
  .setName('credits')
  .setDescription('Zeigt die Credits für den gerade gespielten Titel');

async function execute(interaction) {
  const currentTrack = getCurrentTrack();

  if (!currentTrack) {
    await interaction.reply({ content: '🎵 Gerade läuft nichts.', flags: MessageFlags.Ephemeral });
    return;
  }

  const credit = getCredit(currentTrack);

  if (!credit) {
    await interaction.reply({
      content: `🎵 Aktueller Titel: **${currentTrack.replace(/\.mp3$/i, '').split('/').pop()}**\nFür diesen Titel liegen keine Credit-Angaben vor.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content:
      `🎵 Aktueller Titel: **${credit.title}**\n` +
      `Musik von [${credit.creditName}](${credit.creditUrl}), lizenziert unter ${credit.license}.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
