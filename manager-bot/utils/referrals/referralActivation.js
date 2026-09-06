const { getXpRow } = require('../../storage/xp');
const { getDistinctActiveDayCount } = require('../../storage/stats');
const { getPendingReferral, markReferralActive, getReferralStats } = require('../../storage/referrals');
const { hasBadge, awardBadge } = require('../../storage/badges');
const { logError } = require('../logs/errorLog');

const REQUIRED_XP = 5000;
const REQUIRED_ACTIVE_DAYS = 14;

// Aufsteigend sortiert und einzeln geprüft (nicht nur die höchste erreichte Schwelle vergeben) -
// falls beim Neustart oder durch mehrere gleichzeitig aktiv werdende Referrals der Zähler mehrere
// Schwellen auf einmal überspringt, sollen trotzdem alle bis dahin fehlenden Badges vergeben werden.
const BADGE_THRESHOLDS = [
  { count: 1, key: 'referral_1' },
  { count: 3, key: 'referral_3' },
  { count: 5, key: 'referral_5' },
  { count: 10, key: 'referral_10' },
  { count: 25, key: 'referral_25' },
];

function checkAndAwardBadges(guildId, referrerId) {
  const { active } = getReferralStats(guildId, referrerId);

  for (const { count, key } of BADGE_THRESHOLDS) {
    if (active >= count && !hasBadge(guildId, referrerId, key)) {
      awardBadge(guildId, referrerId, key, { activeReferrals: active });
    }
  }
}

// Wird nach jedem XP-Gewinn für userId aufgerufen (siehe activityTracker.js). Der billige
// Pending-Lookup steht bewusst zuerst, damit normale Nutzer ohne Referral-Historie nicht bei
// jeder Nachricht die teureren XP-/Tage-Abfragen auslösen.
function checkReferralActivation(guildId, userId) {
  const pending = getPendingReferral(guildId, userId);
  if (!pending) return;

  try {
    const xpRow = getXpRow(guildId, userId);
    const totalXp = xpRow?.total_xp ?? 0;
    if (totalXp < REQUIRED_XP) return;

    const activeDays = getDistinctActiveDayCount(guildId, userId);
    if (activeDays < REQUIRED_ACTIVE_DAYS) return;

    markReferralActive(pending.id);
    checkAndAwardBadges(guildId, pending.referrerId);
  } catch (err) {
    logError(err, { context: 'Referral: Aktivierungs-Check', guildId }).catch(() => {});
  }
}

module.exports = {
  checkReferralActivation,
  checkAndAwardBadges,
  REQUIRED_XP,
  REQUIRED_ACTIVE_DAYS,
};
