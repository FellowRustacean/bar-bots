const {
  getThreadId,
  saveThreadId,
  markVoiceChannelDeleted: storeMarkVoiceChannelDeleted,
  getThreadsDueForCleanup,
  deleteThreadRecord,
} = require('../../storage/voiceChannelLogThreads');
const { logError } = require('./errorLog');

const ARCHIVE_DURATION_MINUTES = 10080; // 7 Tage - längstmögliche Discord-Option
const RETENTION_AFTER_DELETE_MS = 7 * 24 * 60 * 60 * 1000; // dieselbe Frist wie beim übrigen Message-Log

// Liefert den Thread im Message-Log-Channel, der den Chat-Mitschnitt eines bestimmten
// Voice-Channels enthält - legt ihn beim ersten Aufruf für diesen Channel an und merkt sich die
// Zuordnung dauerhaft (übersteht Bot-Neustarts), damit alle weiteren Nachrichten/Bearbeitungen/
// Löschungen im selben Thread landen. Der Thread bleibt auch nach der Löschung des Voice-Channels
// noch 7 Tage stehen (siehe cleanupExpiredVoiceChannelThreads), damit die Historie nicht sofort
// mit dem Tisch verschwindet.
async function getOrCreateVoiceChannelThread(logChannel, voiceChannel) {
  const existingId = getThreadId(voiceChannel.id);
  if (existingId) {
    const thread = await logChannel.threads.fetch(existingId).catch(() => null);
    if (thread) return thread;
    // Thread existiert nicht mehr (z. B. manuell gelöscht) - unten neu anlegen.
  }

  const thread = await logChannel.threads.create({
    name: `🔊 ${voiceChannel.name}`.slice(0, 100),
    autoArchiveDuration: ARCHIVE_DURATION_MINUTES,
    reason: 'Chat-Mitschnitt eines Voice-Channels',
  });

  saveThreadId(voiceChannel.id, voiceChannel.guildId, thread.id);
  return thread;
}

// Startet die 7-Tage-Frist für den zugehörigen Thread, sobald der Voice-Channel selbst gelöscht
// wird (z. B. ein Tisch läuft leer) - läuft ins Leere, falls für diesen Channel nie ein Thread
// angelegt wurde (UPDATE ohne Treffer, kein Fehler).
function markVoiceChannelDeleted(channelId) {
  storeMarkVoiceChannelDeleted(channelId, Date.now());
}

async function cleanupExpiredVoiceChannelThreads(client) {
  const cutoff = Date.now() - RETENTION_AFTER_DELETE_MS;
  const due = getThreadsDueForCleanup(cutoff);

  for (const entry of due) {
    try {
      const thread = await client.channels.fetch(entry.threadId).catch(() => null);
      if (thread) await thread.delete().catch(() => {});
    } catch (err) {
      await logError(err, { context: 'Voice-Channel-Thread aufräumen', guildId: entry.guildId });
    } finally {
      deleteThreadRecord(entry.channelId);
    }
  }
}

module.exports = { getOrCreateVoiceChannelThread, markVoiceChannelDeleted, cleanupExpiredVoiceChannelThreads };
