const db = require('./db');
const { localDayBucketStart } = require('../utils/time/localTime');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const bumpActivityStmt = db.prepare(`
  INSERT INTO hourly_activity (guild_id, hour_start, user_id, messages, voice_minutes)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, hour_start, user_id)
  DO UPDATE SET messages = messages + excluded.messages, voice_minutes = voice_minutes + excluded.voice_minutes
`);

const bumpUserStatsStmt = db.prepare(`
  INSERT INTO user_stats (guild_id, user_id, total_messages, total_voice_minutes)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id)
  DO UPDATE SET
    total_messages = total_messages + excluded.total_messages,
    total_voice_minutes = total_voice_minutes + excluded.total_voice_minutes
`);

const hourlySeriesStmt = db.prepare(`
  SELECT hour_start AS bucketStart,
         SUM(messages) AS messages,
         SUM(voice_minutes) AS voiceMinutes,
         COUNT(DISTINCT user_id) AS activeUsers
  FROM hourly_activity
  WHERE guild_id = ? AND hour_start >= ? AND hour_start < ?
  GROUP BY hour_start
  ORDER BY hour_start ASC
`);

// Rohdaten pro Nutzer/Stunde statt bereits in SQL gruppiert - SQLite kennt keine Zeitzonen,
// daher wird die Gruppierung auf lokale Kalendertage unten in JS gemacht (siehe getDailySeries).
const dailyRawStmt = db.prepare(`
  SELECT hour_start AS hourStart, user_id AS userId, messages, voice_minutes AS voiceMinutes
  FROM hourly_activity
  WHERE guild_id = ? AND hour_start >= ? AND hour_start < ?
`);

function hourStart(date = new Date()) {
  return Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;
}

function recordMessage(guildId, userId) {
  const bucket = hourStart();
  bumpActivityStmt.run(guildId, bucket, userId, 1, 0);
  bumpUserStatsStmt.run(guildId, userId, 1, 0);
}

function recordVoiceMinutes(guildId, userId, minutes) {
  if (minutes <= 0) return;
  const bucket = hourStart();
  bumpActivityStmt.run(guildId, bucket, userId, 0, minutes);
  bumpUserStatsStmt.run(guildId, userId, 0, minutes);
}

function getHourlySeries(guildId, startMs, endMs) {
  return hourlySeriesStmt.all(guildId, startMs, endMs);
}

// Gruppiert nach lokalem Kalendertag statt nach UTC-Tag - ein Tag geht sonst z. B. von
// 02:00 bis 02:00 Uhr lokal statt von Mitternacht bis Mitternacht (bei UTC+2).
function getDailySeries(guildId, startMs, endMs) {
  const rows = dailyRawStmt.all(guildId, startMs, endMs);
  const buckets = new Map(); // bucketStart -> { messages, voiceMinutes, users: Set }

  for (const row of rows) {
    const bucketStart = localDayBucketStart(row.hourStart);
    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { bucketStart, messages: 0, voiceMinutes: 0, users: new Set() };
      buckets.set(bucketStart, bucket);
    }
    bucket.messages += row.messages;
    bucket.voiceMinutes += row.voiceMinutes;
    if (row.messages > 0 || row.voiceMinutes > 0) bucket.users.add(row.userId);
  }

  return [...buckets.values()]
    .map(({ bucketStart, messages, voiceMinutes, users }) => ({
      bucketStart,
      messages,
      voiceMinutes,
      activeUsers: users.size,
    }))
    .sort((a, b) => a.bucketStart - b.bucketStart);
}

const referralHourlyStmt = db.prepare(`
  SELECT (joined_at / ${HOUR_MS}) * ${HOUR_MS} AS bucketStart, COUNT(*) AS referralCount
  FROM referrals
  WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?
  GROUP BY bucketStart
  ORDER BY bucketStart ASC
`);

// Analog zu dailyRawStmt oben - Rohdaten statt SQL-Gruppierung, da SQLite keine Zeitzonen kennt
// und die Gruppierung auf lokale Kalendertage in JS passieren muss.
const referralRawStmt = db.prepare(`
  SELECT joined_at AS joinedAt FROM referrals WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?
`);

function getReferralHourlySeries(guildId, startMs, endMs) {
  return referralHourlyStmt.all(guildId, startMs, endMs);
}

function getReferralDailySeries(guildId, startMs, endMs) {
  const rows = referralRawStmt.all(guildId, startMs, endMs);
  const buckets = new Map(); // bucketStart -> referralCount

  for (const row of rows) {
    const bucketStart = localDayBucketStart(row.joinedAt);
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([bucketStart, referralCount]) => ({ bucketStart, referralCount }))
    .sort((a, b) => a.bucketStart - b.bucketStart);
}

const upsertMemberSnapshotStmt = db.prepare(`
  INSERT INTO member_snapshots (guild_id, day_start, total_users, total_guests, total_tags)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, day_start) DO UPDATE SET
    total_users = excluded.total_users,
    total_guests = excluded.total_guests,
    total_tags = excluded.total_tags
`);
const memberSnapshotSeriesStmt = db.prepare(`
  SELECT day_start AS bucketStart, total_users AS totalUsers, total_guests AS totalGuests, total_tags AS totalTags
  FROM member_snapshots
  WHERE guild_id = ? AND day_start >= ? AND day_start < ?
  ORDER BY day_start ASC
`);
const getLastSnapshotDateStmt = db.prepare('SELECT last_snapshot_date AS lastSnapshotDate FROM member_snapshot_state WHERE id = 1');
const setLastSnapshotDateStmt = db.prepare(`
  INSERT INTO member_snapshot_state (id, last_snapshot_date) VALUES (1, ?)
  ON CONFLICT(id) DO UPDATE SET last_snapshot_date = excluded.last_snapshot_date
`);

function recordMemberSnapshot(guildId, dayStart, totalUsers, totalGuests, totalTags) {
  upsertMemberSnapshotStmt.run(guildId, dayStart, totalUsers, totalGuests, totalTags);
}

function getMemberSnapshotSeries(guildId, startMs, endMs) {
  return memberSnapshotSeriesStmt.all(guildId, startMs, endMs);
}

function getLastMemberSnapshotDate() {
  return getLastSnapshotDateStmt.get()?.lastSnapshotDate ?? null;
}

function setLastMemberSnapshotDate(dateString) {
  setLastSnapshotDateStmt.run(dateString);
}

module.exports = {
  HOUR_MS,
  DAY_MS,
  recordMessage,
  recordVoiceMinutes,
  getHourlySeries,
  getDailySeries,
  getReferralHourlySeries,
  getReferralDailySeries,
  recordMemberSnapshot,
  getMemberSnapshotSeries,
  getLastMemberSnapshotDate,
  setLastMemberSnapshotDate,
};
