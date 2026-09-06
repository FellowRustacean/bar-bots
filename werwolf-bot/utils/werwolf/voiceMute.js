async function setPlayerMute(guild, userId, muted, reason) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member?.voice.channelId) {
    await member.voice.setMute(muted, reason).catch(() => {});
  }
}

async function muteAll(guild, userIds, reason) {
  await Promise.all([...userIds].map((id) => setPlayerMute(guild, id, true, reason)));
}

async function unmuteAll(guild, userIds, reason) {
  await Promise.all([...userIds].map((id) => setPlayerMute(guild, id, false, reason)));
}

module.exports = { setPlayerMute, muteAll, unmuteAll };
