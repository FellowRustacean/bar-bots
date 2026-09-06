const { EmbedBuilder } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

async function sendModerationLog(guild, { action, user, moderator, reason, until }) {
  const channelId = getLogChannel(guild.id, 'moderation');
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(action)
    .addFields(
      { name: 'Nutzer', value: `${user} (${user.tag})` },
      { name: 'Teammitglied', value: `${moderator} (${moderator.tag})` },
      { name: 'Grund', value: reason }
    )
    .setTimestamp();

  if (until) {
    embed.addFields({ name: 'Bis', value: `<t:${until}:f>` });
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { sendModerationLog };
