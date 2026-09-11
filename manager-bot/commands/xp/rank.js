const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getXpRow, getRank, getRankedUserCount } = require('../../storage/xp');
const { getLevelProgress } = require('../../utils/xp/leveling');
const { formatNumber } = require('../../utils/format/number');

const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Zeigt den Rang eines Nutzers auf dem Server')
  .addUserOption((opt) => opt.setName('user').setDescription('Nutzer (optional)').setRequired(false));

async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const row = getXpRow(interaction.guildId, target.id);

  if (!row) {
    await interaction.reply({
      content: `${target} hat noch keine XP gesammelt.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rank = getRank(interaction.guildId, target.id);
  const total = getRankedUserCount(interaction.guildId);
  const { level } = getLevelProgress(row.total_xp);

  await interaction.reply({
    content: `${target} ist Rang **${rank}/${total}** (Level **${level}**, **${formatNumber(row.total_xp)} XP**).`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
