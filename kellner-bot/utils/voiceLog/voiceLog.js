const { EmbedBuilder } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

const JOIN_COLOR = 0x57f287;
const LEAVE_COLOR = 0xed4245;

// Nur echte Nutzer, keine Bots - sonst wäre das Log bei der Menge an Bot-Voice-Aktivität
// (24/7-Band, Team-Päuschen) für eine Nutzer-Präsenzübersicht unbrauchbar.
function otherMembersList(channel, excludeUserId) {
  const others = channel.members.filter((member) => !member.user.bot && member.id !== excludeUserId);
  if (others.size === 0) return 'Niemand sonst';
  return others.map((member) => `<@${member.id}>`).join(', ');
}

// Als Embed statt Klartext, damit die Mention im Text nicht pingt (Discord löst Mentions in
// Embeds nur zur Anzeige auf, ohne den Nutzer zu benachrichtigen).
function buildEmbed({ isJoin, member, channel }) {
  return new EmbedBuilder()
    .setColor(isJoin ? JOIN_COLOR : LEAVE_COLOR)
    .setDescription(
      `${isJoin ? '🟢' : '🔴'} <@${member.id}> hat **${channel.name}** ${isJoin ? 'betreten' : 'verlassen'}`
    )
    .addFields({ name: 'Andere im Channel', value: otherMembersList(channel, member.id) })
    .setTimestamp();
}

async function sendLog(guild, logChannelId, embed) {
  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) return;
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

// Wird zusätzlich zum Custom-Voice-System (customVoice.js) aufgerufen - rein passives Loggen,
// unabhängig davon, ob es sich um einen Tisch, den AFK-Channel oder sonst einen Voice-Channel
// handelt. Ein Wechsel zwischen zwei Channels wird als Leave (alter Channel) + Join (neuer
// Channel) geloggt, nicht als eigener "moved"-Fall - dadurch bleibt die Mitgliederliste je
// Eintrag immer exakt der Stand DIESES Channels zu diesem Zeitpunkt.
async function handleVoiceLog(oldState, newState) {
  if (oldState.channelId === newState.channelId) return; // reiner Mute/Deafen-Wechsel

  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild ?? oldState.guild;
  const logChannelId = getLogChannel(guild.id, 'voice');
  if (!logChannelId) return;

  if (oldState.channel) {
    await sendLog(guild, logChannelId, buildEmbed({ isJoin: false, member, channel: oldState.channel }));
  }

  if (newState.channel) {
    await sendLog(guild, logChannelId, buildEmbed({ isJoin: true, member, channel: newState.channel }));
  }
}

module.exports = { handleVoiceLog };
