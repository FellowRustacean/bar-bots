const db = require('./db');

const getLinkStmt = db.prepare(
  'SELECT invite_code AS inviteCode, created_at AS createdAt FROM referral_links WHERE guild_id = ? AND user_id = ?'
);
const insertLinkStmt = db.prepare(
  'INSERT INTO referral_links (guild_id, user_id, invite_code, created_at) VALUES (?, ?, ?, ?)'
);
const getReferrerByCodeStmt = db.prepare(
  'SELECT user_id AS userId FROM referral_links WHERE guild_id = ? AND invite_code = ?'
);

const insertReferralStmt = db.prepare(`
  INSERT OR IGNORE INTO referrals (guild_id, referrer_id, referred_user_id, invite_code, joined_at)
  VALUES (?, ?, ?, ?, ?)
`);
const getPendingReferralStmt = db.prepare(
  'SELECT id, referrer_id AS referrerId FROM referrals WHERE guild_id = ? AND referred_user_id = ? AND is_active = 0'
);
const markActiveStmt = db.prepare('UPDATE referrals SET is_active = 1, active_at = ? WHERE id = ?');
const joinedCountStmt = db.prepare('SELECT COUNT(*) AS count FROM referrals WHERE guild_id = ? AND referrer_id = ?');
const activeCountStmt = db.prepare(
  'SELECT COUNT(*) AS count FROM referrals WHERE guild_id = ? AND referrer_id = ? AND is_active = 1'
);

function getReferralLink(guildId, userId) {
  return getLinkStmt.get(guildId, userId) ?? null;
}

function createReferralLink(guildId, userId, inviteCode, createdAt = Date.now()) {
  insertLinkStmt.run(guildId, userId, inviteCode, createdAt);
}

function getReferrerIdByCode(guildId, inviteCode) {
  return getReferrerByCodeStmt.get(guildId, inviteCode)?.userId ?? null;
}

// Ignoriert den Insert stillschweigend, falls dieser Nutzer in dieser Guild schon einmal als
// geworben erfasst wurde (UNIQUE(guild_id, referred_user_id)) - der zuerst erfasste Beitritt
// zählt. Gibt zurück, ob wirklich neu erfasst wurde.
function recordReferral(guildId, referrerId, referredUserId, inviteCode, joinedAt = Date.now()) {
  const result = insertReferralStmt.run(guildId, referrerId, referredUserId, inviteCode, joinedAt);
  return result.changes > 0;
}

function getPendingReferral(guildId, referredUserId) {
  return getPendingReferralStmt.get(guildId, referredUserId) ?? null;
}

function markReferralActive(referralId, activeAt = Date.now()) {
  markActiveStmt.run(activeAt, referralId);
}

function getReferralStats(guildId, referrerId) {
  return {
    joined: joinedCountStmt.get(guildId, referrerId).count,
    active: activeCountStmt.get(guildId, referrerId).count,
  };
}

module.exports = {
  getReferralLink,
  createReferralLink,
  getReferrerIdByCode,
  recordReferral,
  getPendingReferral,
  markReferralActive,
  getReferralStats,
};
