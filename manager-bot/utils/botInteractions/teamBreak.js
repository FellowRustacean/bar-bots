const { getVoiceSettings } = require('../../storage/voiceSettings');
const teamMeetingStore = require('../../storage/teamMeeting');

const CANDIDATE_BOTS = ['manager', 'techniker', 'werwolf', 'kellner', 'barkeeper', 'tuersteher'];

const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 4;

const FOLLOWER_JOIN_DELAY_MIN_MS = 5 * 1000;
const FOLLOWER_JOIN_DELAY_MAX_MS = 60 * 1000;

const MEETING_DURATION_MIN_MS = 15 * 60 * 1000;
const MEETING_DURATION_MAX_MS = 25 * 60 * 1000;

const LEAVE_STAGGER_MIN_MS = 30 * 1000;
const LEAVE_STAGGER_MAX_MS = 60 * 1000;

function randomInt(minInclusive, maxInclusive) {
  return minInclusive + Math.floor(Math.random() * (maxInclusive - minInclusive + 1));
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Nur zwischen 10 und 22 Uhr (lokale Server-Zeit) - außerhalb dieser Zeit soll sich kein
// "Team-Päuschen" mehr am Tisch treffen.
async function canRunTeamBreak(client) {
  const hour = new Date().getHours();
  if (hour < 10 || hour >= 22) return false;

  for (const guild of client.guilds.cache.values()) {
    const settings = getVoiceSettings(guild.id);
    if (settings?.voiceChannelId && settings?.voiceCategoryId) return true;
  }
  return false;
}

// Plant ein Team-Päuschen: ein zufällig gewählter Bot (Leader) geht in "Tisch bestellen" und
// bekommt darüber ganz normal einen neuen Tisch, 1-3 weitere Bots (Follower) betreten diesen
// Tisch danach unabhängig zufällig versetzt. Die eigentliche Ausführung (Beitreten/Verlassen)
// übernimmt jeder beteiligte Bot selbst über seinen eigenen teamMeetingPoller - diese Funktion
// plant nur die Termine in der DB, sie stellt selbst keine Voice-Verbindung her.
async function runTeamBreak(client) {
  for (const guild of client.guilds.cache.values()) {
    const settings = getVoiceSettings(guild.id);
    if (!settings?.voiceChannelId || !settings?.voiceCategoryId) continue;

    const participantCount = randomInt(MIN_PARTICIPANTS, MAX_PARTICIPANTS);
    const chosen = shuffle(CANDIDATE_BOTS).slice(0, participantCount);
    const leader = chosen[Math.floor(Math.random() * chosen.length)];
    const followers = chosen.filter((botName) => botName !== leader);

    const now = Date.now();
    const meetingEndAt = now + randomInt(MEETING_DURATION_MIN_MS, MEETING_DURATION_MAX_MS);

    const meetingId = teamMeetingStore.createMeeting(guild.id, settings.voiceChannelId, now);

    teamMeetingStore.addParticipant(
      meetingId,
      leader,
      'leader',
      now,
      meetingEndAt + randomInt(LEAVE_STAGGER_MIN_MS, LEAVE_STAGGER_MAX_MS)
    );

    for (const botName of followers) {
      teamMeetingStore.addParticipant(
        meetingId,
        botName,
        'follower',
        now + randomInt(FOLLOWER_JOIN_DELAY_MIN_MS, FOLLOWER_JOIN_DELAY_MAX_MS),
        meetingEndAt + randomInt(LEAVE_STAGGER_MIN_MS, LEAVE_STAGGER_MAX_MS)
      );
    }

    return; // ein Durchlauf pro Aufruf reicht - dieses Setup hat ohnehin nur einen Server.
  }
}

module.exports = { canRunTeamBreak, runTeamBreak };
