const { getMemberRoleId } = require('../../storage/roleSettings');
const {
  recordMemberSnapshot,
  getLastMemberSnapshotDate,
  setLastMemberSnapshotDate,
} = require('../../storage/stats');
const { startDailyTicker } = require('../../../shared/lib/dailyTicker');
const { logError } = require('../logs/errorLog');

function localMidnight(date = new Date()) {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countTags(humans, guildId) {
  return humans.filter(
    (member) =>
      member.user.primaryGuild?.identityGuildId === guildId && member.user.primaryGuild?.identityEnabled === true
  ).size;
}

// "Nutzer" = alle Nicht-Bot-Mitglieder. "Gäste" = davon die, die die konfigurierte member-Rolle
// (aktuell @Gast) haben. "Tags" = davon die, die diesen Server aktuell als Server-Tag (primary
// guild) eingeblendet haben - braucht einen vollständigen Member-Fetch (nicht nur den Cache),
// sonst wäre die Zählung je nach Bot-Laufzeit/Cache-Stand unvollständig.
async function takeMemberSnapshot(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch();
      const memberRoleId = getMemberRoleId(guild.id);

      const humans = members.filter((member) => !member.user.bot);
      const totalUsers = humans.size;
      const totalGuests = memberRoleId
        ? humans.filter((member) => member.roles.cache.has(memberRoleId)).size
        : 0;
      let totalTags = countTags(humans, guild.id);

      // Direkt nach einem Bot-Neustart (z. B. Deploy kurz vor Mitternacht) ist das
      // primaryGuild-Feld der User-Objekte manchmal noch nicht befüllt, obwohl der Member-Fetch
      // selbst schon vollständig ist - dann kommt fälschlich 0 raus, obwohl es Mitglieder gibt.
      // Einmaliger Retry nach kurzer Wartezeit fängt genau dieses Zeitfenster ab.
      if (totalTags === 0 && totalUsers > 0) {
        await sleep(5000);
        const retryMembers = await guild.members.fetch({ force: true });
        const retryHumans = retryMembers.filter((member) => !member.user.bot);
        totalTags = countTags(retryHumans, guild.id);
      }

      recordMemberSnapshot(guild.id, localMidnight(), totalUsers, totalGuests, totalTags);
    } catch (err) {
      await logError(err, { context: 'Täglicher Mitglieder-Snapshot', guildId: guild.id });
    }
  }

  console.log('Täglicher Mitglieder-Snapshot durchgeführt.');
}

function startMemberSnapshotTimer(client) {
  const nextRun = startDailyTicker({
    task: () => takeMemberSnapshot(client),
    getLastRunDate: getLastMemberSnapshotDate,
    setLastRunDate: setLastMemberSnapshotDate,
  });

  console.log(`Mitglieder-Snapshot geplant. Nächster Snapshot: ${nextRun.toLocaleString()}`);
}

module.exports = { takeMemberSnapshot, startMemberSnapshotTimer };
