const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getXpRow, getRemainingDailyXp, DAILY_CAP } = require('../../storage/xp');
const { getLevelProgress } = require('../../utils/xp/leveling');
const { getUserBadgeTotalCount } = require('../../storage/badges');
const { hasServerTag } = require('../../../shared/lib/serverTag');
const { formatNumber } = require('../../utils/format/number');

const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Zeigt dein Profil oder das eines anderen Nutzers')
  .addUserOption((opt) => opt.setName('user').setDescription('Nutzer (optional)').setRequired(false));

function buildProgressBar(current, max, length = 20) {
  const ratio = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(ratio * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const row = getXpRow(interaction.guildId, target.id);
  const totalXp = row?.total_xp ?? 0;
  const { level, xpIntoLevel, xpForNextLevel } = getLevelProgress(totalXp);
  const badgeCount = getUserBadgeTotalCount(interaction.guildId, target.id);
  const remainingDailyXp = getRemainingDailyXp(interaction.guildId, target.id);
  const isBoosting = Boolean(member?.premiumSinceTimestamp);
  const hasTag = hasServerTag(member);

  // Beide Boni werden hier nur als Text erwähnt (die eigentliche Berechnung/Addition passiert in
  // utils/activity/activityTracker.js) - Reihenfolge und Wortlaut bewusst analog zueinander gehalten.
  const bonusNotes = [];
  if (isBoosting) bonusNotes.push('🚀 Nitro-Booster: +20% XP');
  if (hasTag) bonusNotes.push('🏷️ Server-Tag: +10% XP');
  const bonusSuffix = bonusNotes.length > 0 ? ` (${bonusNotes.join(', ')})` : '';

  const embed = new EmbedBuilder()
    .setTitle(`Profil von ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      {
        name: 'Beigetreten',
        value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>` : 'Unbekannt',
      },
      { name: 'Level', value: `${level}` },
      {
        // Balken nutzt die ungerundeten Werte für den exakten Fortschritt, angezeigt wird
        // gerundet (XP-Spalten sind DECIMAL, können künftig Nachkommastellen enthalten).
        name: 'Fortschritt zum nächsten Level',
        value: `${buildProgressBar(xpIntoLevel, xpForNextLevel)}\n${formatNumber(xpIntoLevel)} / ${formatNumber(xpForNextLevel)} XP`,
      },
      {
        name: 'Gesamt-XP',
        value: `${formatNumber(totalXp)}${bonusSuffix}`,
      },
      {
        name: 'Heute noch sammelbar',
        value: `${formatNumber(remainingDailyXp)} / ${formatNumber(DAILY_CAP)} XP`,
      },
      // Nur ein Zähler - die Details (welche Badges, wie oft, wann) gibt's über /badges, damit
      // dieses Feld nicht mit der Zeit über Jahre hinweg überläuft.
      { name: 'Badges', value: `🏅 ${badgeCount}${badgeCount > 0 ? ' - siehe `/badges`' : ''}` }
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
