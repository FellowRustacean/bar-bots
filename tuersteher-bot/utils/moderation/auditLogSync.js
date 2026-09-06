const { AuditLogEvent } = require('discord.js');
const { sendModerationLog } = require('../logs/moderationLog');
const { addBanRecord, removeBanRecord } = require('../../storage/bans');
const { removeTempban } = require('../../storage/tempbans');
const { logError } = require('../logs/errorLog');

const RECENT_WINDOW_MS = 10_000;

// Gateway-Events wie guildBanAdd/guildMemberRemove/guildMemberUpdate verraten selbst nicht, WER
// die Aktion ausgelöst hat - weder ob überhaupt ein Mensch dahintersteckt noch ob es der Bot
// selbst über einen eigenen Slash-Command war. Das Audit-Log ist die einzige Quelle dafür, daher
// hier der jüngste passende Eintrag für den betroffenen Nutzer.
async function findRecentAuditEntry(guild, type, targetId) {
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  if (!logs) return null;

  return (
    [...logs.entries.values()].find(
      (entry) => entry.target?.id === targetId && Date.now() - entry.createdTimestamp < RECENT_WINDOW_MS
    ) ?? null
  );
}

async function handleManualBan(ban) {
  try {
    const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    // Kein Eintrag gefunden, oder der Bot war es selbst (z. B. über /ban oder /tempban) -
    // in dem Fall hat der jeweilige Command bereits geloggt und die Datenbank aktualisiert.
    if (!entry || entry.executor?.id === ban.guild.client.user.id) return;

    addBanRecord(ban.guild.id, ban.user.id, ban.user.username);

    await sendModerationLog(ban.guild, {
      action: 'Bann (manuell)',
      user: ban.user,
      moderator: entry.executor,
      reason: entry.reason || 'Kein Grund angegeben',
    });
  } catch (err) {
    await logError(err, { context: 'Manuelle Bann-Erkennung', guildId: ban.guild?.id });
  }
}

async function handleManualUnban(ban) {
  try {
    const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    if (!entry || entry.executor?.id === ban.guild.client.user.id) return;

    removeBanRecord(ban.guild.id, ban.user.id);
    removeTempban(ban.guild.id, ban.user.id);

    await sendModerationLog(ban.guild, {
      action: 'Entbannung (manuell)',
      user: ban.user,
      moderator: entry.executor,
      reason: entry.reason || 'Kein Grund angegeben',
    });
  } catch (err) {
    await logError(err, { context: 'Manuelle Entbannungs-Erkennung', guildId: ban.guild?.id });
  }
}

async function handleManualKick(member) {
  try {
    const entry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!entry || entry.executor?.id === member.guild.client.user.id) return;

    await sendModerationLog(member.guild, {
      action: 'Kick (manuell)',
      user: member.user,
      moderator: entry.executor,
      reason: entry.reason || 'Kein Grund angegeben',
    });
  } catch (err) {
    await logError(err, { context: 'Manuelle Kick-Erkennung', guildId: member.guild?.id });
  }
}

async function handleManualTimeoutChange(oldMember, newMember) {
  const oldUntil = oldMember.communicationDisabledUntilTimestamp ?? null;
  const newUntil = newMember.communicationDisabledUntilTimestamp ?? null;
  if (oldUntil === newUntil) return;

  try {
    const entry = await findRecentAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    if (!entry || entry.executor?.id === newMember.guild.client.user.id) return;

    const timeoutRemoved = newUntil === null || newUntil <= Date.now();

    await sendModerationLog(newMember.guild, {
      action: timeoutRemoved ? 'Entmutet (manuell)' : 'Mute (manuell)',
      user: newMember.user,
      moderator: entry.executor,
      reason: entry.reason || 'Kein Grund angegeben',
      until: timeoutRemoved ? undefined : Math.floor(newUntil / 1000),
    });
  } catch (err) {
    await logError(err, { context: 'Manuelle Timeout-Erkennung', guildId: newMember.guild?.id });
  }
}

module.exports = { handleManualBan, handleManualUnban, handleManualKick, handleManualTimeoutChange };
