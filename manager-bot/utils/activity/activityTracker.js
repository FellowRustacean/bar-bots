const { addXp } = require('../../storage/xp');
const { recordMessage, recordVoiceMinutes } = require('../../storage/stats');
const { getAfkChannelId } = require('../../storage/afkSettings');
const { touchActivity } = require('../../storage/memberActivity');
const { hasServerTag } = require('../../../shared/lib/serverTag');
const { checkReferralActivation } = require('../referrals/referralActivation');

const MESSAGE_XP = 5;
const MESSAGE_COOLDOWN_MS = 60 * 1000;
const VOICE_XP_PER_MINUTE = 3;
const HOUR_MS = 60 * 60 * 1000;

// Nitro-Booster bekommen 20% mehr XP, Träger des eigenen Server-Tags nochmal 10% - beide Boni
// addieren sich (nicht multiplikativ), damit z. B. ein Booster mit Server-Tag klar +30% bekommt
// statt der weniger nachvollziehbaren 1.2*1.1=1.32. Das Tageslimit (DAILY_CAP in storage/xp.js)
// gilt unverändert für alle, da der Bonus schon VOR dem Aufruf von addXp() eingerechnet wird.
const BOOSTER_XP_BONUS = 0.2;
const SERVER_TAG_XP_BONUS = 0.1;

const messageCooldowns = new Map(); // `${guildId}:${userId}` -> letzter XP-Zeitpunkt
const voiceSessions = new Map(); // `${guildId}:${userId}` -> { channelId, since }

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function isBoosting(member) {
  return Boolean(member?.premiumSinceTimestamp);
}

function xpBonusMultiplier(member) {
  let bonus = 0;
  if (isBoosting(member)) bonus += BOOSTER_XP_BONUS;
  if (hasServerTag(member)) bonus += SERVER_TAG_XP_BONUS;
  return 1 + bonus;
}

function applyBonus(baseAmount, member) {
  return baseAmount * xpBonusMultiplier(member);
}

function handleMessage(message) {
  if (!message.guild || !message.author || message.author.bot) return;

  recordMessage(message.guild.id, message.author.id);
  touchActivity(message.guild.id, message.author.id);

  const key = sessionKey(message.guild.id, message.author.id);
  const now = Date.now();
  const last = messageCooldowns.get(key) || 0;
  if (now - last < MESSAGE_COOLDOWN_MS) return;

  messageCooldowns.set(key, now);
  const amount = applyBonus(MESSAGE_XP, message.member);
  addXp(message.guild.id, message.author.id, amount, 'message');
  checkReferralActivation(message.guild.id, message.author.id);
}

// Rechnet die seit Sitzungsbeginn vergangene Zeit ab: immer für Statistiken,
// nur für XP/Aktivität, wenn der Channel nicht der AFK-Channel ist.
function settleSession(guildId, userId, channelId, since, now, member) {
  const minutes = Math.floor((now - since) / 60000);
  if (minutes <= 0) return;

  recordVoiceMinutes(guildId, userId, minutes);

  const afkChannelId = getAfkChannelId(guildId);
  if (channelId !== afkChannelId) {
    const amount = applyBonus(minutes * VOICE_XP_PER_MINUTE, member);
    addXp(guildId, userId, amount, 'voice');
    touchActivity(guildId, userId, now);
    checkReferralActivation(guildId, userId);
  }
}

function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return;

  const guildId = newState.guild.id;
  const userId = member.id;
  const key = sessionKey(guildId, userId);
  const now = Date.now();

  const session = voiceSessions.get(key);
  if (session) {
    settleSession(guildId, userId, session.channelId, session.since, now, member);
    voiceSessions.delete(key);
  }

  if (newState.channelId) {
    voiceSessions.set(key, { channelId: newState.channelId, since: now });
  }
}

// messageCooldowns sammelt sonst für immer einen Eintrag pro Mitglied, das je geschrieben hat -
// ein Eintrag ist aber schon nach MESSAGE_COOLDOWN_MS wertlos (nur zur Cooldown-Prüfung nötig),
// daher hier im ohnehin stündlichen Tick mit aufräumen statt einer eigenen Schedule dafür.
function pruneMessageCooldowns() {
  const now = Date.now();
  for (const [key, last] of messageCooldowns) {
    if (now - last >= MESSAGE_COOLDOWN_MS) messageCooldowns.delete(key);
  }
}

// Rechnet alle laufenden Sitzungen ab und startet sie neu - für den stündlichen Tick. Bonus-Status
// (Boost/Server-Tag) wird dabei frisch aus dem Member-Cache gelesen (nicht vom Sitzungsbeginn
// übernommen) - ändert sich mitten in einer Sitzung, zählt für die gesamte abgerechnete Stunde
// einheitlich der Stand zum Abrechnungszeitpunkt. Fehlt der Member im Cache (selten), fällt es
// einmalig auf "kein Bonus" zurück statt extra nachzuladen - bei einem reinen Bonus-Multiplikator
// vertretbar.
function settleAllSessions(client) {
  const now = Date.now();
  for (const [key, session] of voiceSessions) {
    const [guildId, userId] = key.split(':');
    const member = client.guilds.cache.get(guildId)?.members.cache.get(userId);
    settleSession(guildId, userId, session.channelId, session.since, now, member);
    voiceSessions.set(key, { channelId: session.channelId, since: now });
  }
  pruneMessageCooldowns();
}

// Muss beim Bot-Start aufgerufen werden: verhindert, dass eine lange Downtime
// fälschlich als Voice-Zeit angerechnet wird (Sitzungsbeginn = jetzt).
function initializeVoiceSessions(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const voiceState of guild.voiceStates.cache.values()) {
      if (!voiceState.channelId || voiceState.member?.user?.bot) continue;
      voiceSessions.set(sessionKey(guild.id, voiceState.id), {
        channelId: voiceState.channelId,
        since: now,
      });
    }
  }
}

function startHourlyTick(client) {
  const msUntilNextHour = HOUR_MS - (Date.now() % HOUR_MS);
  setTimeout(() => {
    settleAllSessions(client);
    setInterval(() => settleAllSessions(client), HOUR_MS);
  }, msUntilNextHour);
}

module.exports = {
  handleMessage,
  handleVoiceStateUpdate,
  initializeVoiceSessions,
  startHourlyTick,
};
