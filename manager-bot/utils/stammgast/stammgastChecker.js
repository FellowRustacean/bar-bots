const { getUserIdsAtOrAboveXp } = require('../../storage/xp');
const { getStammgastRoleId } = require('../../storage/roleSettings');
const { getLogChannel } = require('../../storage/guildConfig');
const { logError } = require('../logs/errorLog');
const { formatNumber } = require('../format/number');

const STAMMGAST_XP_THRESHOLD = 50_000;
const STAMMGAST_MIN_MEMBERSHIP_MONTHS = 3;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function getTeamChannel(guild) {
  const channelId = getLogChannel(guild.id, 'stammgast');
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

// Kalendermonate statt fixer Tageszahl (90 Tage etc.) - "3 Monate" soll sich auf den
// tatsächlichen Beitrittszeitpunkt beziehen, nicht auf eine Näherung.
function joinedAtLeastMonthsAgo(member, months) {
  if (!member.joinedTimestamp) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return member.joinedTimestamp <= cutoff.getTime();
}

// "Event": Rolle vergeben + Nutzer per DM informieren + Team-Channel benachrichtigen - alles drei
// bei jeder frisch erreichten Beförderung, unabhängig voneinander (eine fehlschlagende DM z. B.
// bei deaktivierten DMs darf die Rollenvergabe/Team-Meldung nicht verhindern).
async function promoteToStammgast(guild, member, role) {
  await member.roles.add(role, `Stammgast-Schwelle erreicht (${formatNumber(STAMMGAST_XP_THRESHOLD)} XP, ${STAMMGAST_MIN_MEMBERSHIP_MONTHS} Monate dabei)`);

  try {
    await member.send(
      `🎉 Herzlichen Glückwunsch! Du bist auf **${guild.name}** seit mindestens ${STAMMGAST_MIN_MEMBERSHIP_MONTHS} Monaten dabei und hast ${formatNumber(STAMMGAST_XP_THRESHOLD)} XP erreicht - jetzt bist du **Stammgast**.\n` +
        'Damit kannst du `/silence` nutzen, um jemanden bei Bedarf für 8 Stunden stummzuschalten - Missbrauch kann zum Entzug dieses Rechts und weiteren Sanktionen führen.'
    );
  } catch (err) {
    // Nutzer hat DMs deaktiviert - Beförderung bleibt trotzdem gültig
  }

  const teamChannel = await getTeamChannel(guild);
  if (teamChannel) {
    await teamChannel
      .send({ content: `🎉 ${member} ist jetzt **Stammgast** (${formatNumber(STAMMGAST_XP_THRESHOLD)} XP, ${STAMMGAST_MIN_MEMBERSHIP_MONTHS}+ Monate dabei) und hat die Rolle ${role} erhalten.` })
      .catch(() => {});
  }
}

async function checkGuildForNewStammgaeste(guild) {
  const roleId = getStammgastRoleId(guild.id);
  if (!roleId) return;

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return;

  const candidateIds = getUserIdsAtOrAboveXp(guild.id, STAMMGAST_XP_THRESHOLD);

  for (const userId of candidateIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.roles.cache.has(roleId)) continue;
    if (!joinedAtLeastMonthsAgo(member, STAMMGAST_MIN_MEMBERSHIP_MONTHS)) continue;

    await promoteToStammgast(guild, member, role);
  }
}

async function checkAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await checkGuildForNewStammgaeste(guild);
    } catch (err) {
      await logError(err, { context: 'Stammgast-Beförderung prüfen', guildId: guild.id });
    }
  }
}

function startStammgastChecker(client) {
  checkAllGuilds(client).catch((err) => logError(err, { context: 'Stammgast-Check (Start)' }));
  setInterval(() => {
    checkAllGuilds(client).catch((err) => logError(err, { context: 'Stammgast-Check' }));
  }, CHECK_INTERVAL_MS);
}

module.exports = { startStammgastChecker };
