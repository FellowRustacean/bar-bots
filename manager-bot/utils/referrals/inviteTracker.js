const { getReferrerIdByCode, recordReferral } = require('../../storage/referrals');
const { logError } = require('../logs/errorLog');

// guildId -> Map(inviteCode -> uses) - wird beim Start befüllt und bei jedem Beitritt/Invite-
// Event aktuell gehalten. Discord liefert bei guildMemberAdd selbst NICHT mit, welcher Invite
// benutzt wurde - das lässt sich nur per Diff der uses-Zähler vorher/nachher ermitteln.
const inviteUsesCache = new Map();

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    for (const invite of invites.values()) {
      map.set(invite.code, invite.uses ?? 0);
    }
    inviteUsesCache.set(guild.id, map);
  } catch (err) {
    await logError(err, {
      context: 'Referral: Invite-Cache aufbauen (fehlt dem Bot "Server verwalten"?)',
      guildId: guild.id,
    });
  }
}

async function initializeInviteCache(client) {
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
}

function handleInviteCreate(invite) {
  if (!invite.guild) return;
  const map = inviteUsesCache.get(invite.guild.id);
  if (map) map.set(invite.code, invite.uses ?? 0);
}

function handleInviteDelete(invite) {
  if (!invite.guild) return;
  const map = inviteUsesCache.get(invite.guild.id);
  if (map) map.delete(invite.code);
}

// Vergleicht die uses-Zähler vor/nach dem Beitritt, um den benutzten Code zu finden. Bei
// mehreren gleichzeitigen Beitritten (Race, mehrere Codes mit erhöhtem Zähler) lässt sich der
// Code nicht eindeutig zuordnen - dann lieber gar keinen Referral erfassen als einen falschen.
async function findUsedInviteCode(guild) {
  const before = inviteUsesCache.get(guild.id) ?? new Map();

  let invites;
  try {
    invites = await guild.invites.fetch();
  } catch (err) {
    await logError(err, {
      context: 'Referral: Invites nach Beitritt abrufen (fehlt dem Bot "Server verwalten"?)',
      guildId: guild.id,
    });
    return null;
  }

  const after = new Map();
  let usedCode = null;
  let matches = 0;

  for (const invite of invites.values()) {
    const uses = invite.uses ?? 0;
    after.set(invite.code, uses);
    if (uses > (before.get(invite.code) ?? 0)) {
      usedCode = invite.code;
      matches++;
    }
  }

  inviteUsesCache.set(guild.id, after);

  return matches === 1 ? usedCode : null;
}

async function handleGuildMemberAdd(member) {
  if (member.user.bot) return;

  try {
    const usedCode = await findUsedInviteCode(member.guild);
    if (!usedCode) return;

    const referrerId = getReferrerIdByCode(member.guild.id, usedCode);
    if (!referrerId || referrerId === member.id) return;

    recordReferral(member.guild.id, referrerId, member.id, usedCode);
  } catch (err) {
    await logError(err, { context: 'Referral: Beitritt zuordnen', guildId: member.guild.id });
  }
}

module.exports = {
  initializeInviteCache,
  handleInviteCreate,
  handleInviteDelete,
  handleGuildMemberAdd,
};
