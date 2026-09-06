const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getLeaderboard } = require('../../storage/xp');
const { formatNumber } = require('../../utils/format/number');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Zeigt die Top 10 des Servers')
  .addStringOption((opt) =>
    opt
      .setName('type')
      .setDescription('Zeitraum')
      .setRequired(true)
      .addChoices({ name: 'total', value: 'total' }, { name: 'month', value: 'month' })
  );

async function execute(interaction) {
  const type = interaction.options.getString('type', true);
  const rows = getLeaderboard(interaction.guildId, type);

  if (rows.length === 0) {
    await interaction.reply({ content: 'Es gibt noch keine XP-Einträge auf diesem Server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const title = type === 'total' ? '🏆 Gesamt-Leaderboard' : '🏆 Leaderboard (diesen Monat)';
  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.userId}> - **${formatNumber(r.xp)} XP**`);

  await interaction.reply({ content: `${title}\n\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
