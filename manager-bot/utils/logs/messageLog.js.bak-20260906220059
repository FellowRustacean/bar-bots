const { AttachmentBuilder, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');
const { buildDiff } = require('./messageDiff');
const {
  getOrCreateVoiceChannelThread,
  markVoiceChannelDeleted,
  cleanupExpiredVoiceChannelThreads,
} = require('./voiceChannelThreads');
const { logError } = require('./errorLog');
const {
  getStoredMessageContent,
  deleteStoredMessageContent,
  cleanupOldMessageContent,
} = require('../../storage/recentMessageContent');

const MAX_FIELD_LENGTH = 1000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MESSAGE_CONTENT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 Tage - siehe recent_message_content in schema.js
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // alle 6 Stunden prüfen

// Rote/gelbe Linie am Embed-Rand als sofort erkennbares Highlight, zusätzlich zum Kreis-Emoji im
// Titel (falls die Farbe z. B. wegen Colorblind-Modus schwer zu unterscheiden ist).
const DELETE_COLOR = 0xed4245;
const EDIT_COLOR = 0xfee75c;
const AUDIT_LOG_MATCH_WINDOW_MS = 10_000;

function truncate(text) {
  if (!text) return '*Kein Textinhalt*';
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}…` : text;
}

function asBlockquote(text) {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

async function downloadAttachments(attachments) {
  const files = [];
  const notes = [];

  for (const attachment of attachments.values()) {
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      notes.push(
        `${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(1)} MB, zu groß zum erneuten Hochladen) - ${attachment.url}`
      );
      continue;
    }

    try {
      const response = await fetch(attachment.url);
      const buffer = Buffer.from(await response.arrayBuffer());
      files.push(new AttachmentBuilder(buffer, { name: attachment.name }));
    } catch (err) {
      notes.push(`${attachment.name} (konnte nicht heruntergeladen werden) - ${attachment.url}`);
    }
  }

  return { files, notes };
}

async function getMessageLogChannel(guild) {
  const channelId = getLogChannel(guild.id, 'messages');
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

function isLoggable(message) {
  return Boolean(message.guild) && Boolean(message.author) && message.author.id !== message.client.user.id;
}

// Discord legt nur dann einen Audit-Log-Eintrag für eine gelöschte Nachricht an, wenn ein
// Moderator (nicht der Autor selbst) sie gelöscht hat - fehlt ein passender Eintrag, war es mit
// hoher Wahrscheinlichkeit der Autor selbst. Erfordert die "Audit-Log ansehen"-Berechtigung; ohne
// sie (oder bei sonstigen Fehlern) wird einfach null zurückgegeben statt abzustürzen.
async function fetchDeletionExecutor(guild, channelId, authorId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
    const entry = logs.entries.find(
      (e) =>
        e.target?.id === authorId &&
        e.extra?.channel?.id === channelId &&
        Date.now() - e.createdTimestamp < AUDIT_LOG_MATCH_WINDOW_MS
    );
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

function deletedByLine(executor, authorId) {
  if (executor && executor.id !== authorId) return `Gelöscht von: ${executor} (${executor.tag})`;
  return 'Gelöscht von: vermutlich vom Autor selbst';
}

async function buildAttachmentsSection(message) {
  const { files, notes } = message.attachments?.size
    ? await downloadAttachments(message.attachments)
    : { files: [], notes: [] };
  return { files, notes };
}

// Discord liefert beim messageDelete-Gateway-Event selbst nur {id, channel_id, guild_id} - Autor
// und Inhalt kennt discord.js nur, wenn die Nachricht noch im (bewusst knappen, siehe
// clientCacheOptions.js) RAM-Nachrichten-Cache war. Fehlt beides oder eines davon, wird die eigene
// kurzlebige Kopie aus recent_message_content als Fallback herangezogen (siehe recordMessageContent
// in index.js) - so wird eine Löschung auch dann noch sinnvoll geloggt, wenn discord.js selbst
// nichts mehr über die Nachricht weiß, statt sie (wie vorher) komplett stillschweigend zu ignorieren.
async function logMessageDelete(message) {
  if (!message.guild) return;

  const stored = getStoredMessageContent(message.id);

  const authorId = message.author?.id ?? stored?.authorId;
  if (!authorId || authorId === message.client.user.id) return;

  const authorTag = message.author?.tag ?? stored?.authorTag ?? 'Unbekannt';
  const authorMention = `<@${authorId}>`;

  const logChannel = await getMessageLogChannel(message.guild);
  if (!logChannel) return;

  const isVoiceChannel = message.channel.isVoiceBased();
  const executor = await fetchDeletionExecutor(message.guild, message.channelId, authorId);

  const liveContentKnown = !message.partial && typeof message.content === 'string';
  // truncate('') liefert bewusst "*Kein Textinhalt*" (Nachricht hatte wirklich keinen Text, z. B.
  // nur ein Bild) - das hier ist der einzige Fall, in dem wirklich nichts (weder live noch aus dem
  // eigenen Backup) bekannt ist, und verdient deshalb eine eigene, unmissverständliche Zeile.
  const content = liveContentKnown
    ? truncate(message.content)
    : stored
      ? truncate(stored.content)
      : '*Inhalt nicht mehr verfügbar (zu lange her)*';

  const { files, notes } = await buildAttachmentsSection(message);

  const descriptionLines = isVoiceChannel
    ? [`${authorMention} (${authorTag})`, deletedByLine(executor, authorId)]
    : [`${message.channel} • ${authorMention} (${authorTag})`, deletedByLine(executor, authorId)];
  descriptionLines.push(asBlockquote(content));

  const embed = new EmbedBuilder()
    .setTitle('🔴 Nachricht gelöscht')
    .setDescription(descriptionLines.join('\n'))
    .setColor(DELETE_COLOR)
    .setTimestamp();

  if (notes.length) embed.addFields({ name: 'Medien (nicht wiederhergestellt)', value: notes.join('\n') });

  const target = isVoiceChannel ? await getOrCreateVoiceChannelThread(logChannel, message.channel) : logChannel;
  await target.send({ embeds: [embed], files }).catch(() => {});

  deleteStoredMessageContent(message.id);
}

async function logMessageEdit(oldMessage, newMessage) {
  if (!isLoggable(newMessage)) return;

  const oldContentKnown = !oldMessage.partial && oldMessage.content != null;
  if (oldContentKnown && oldMessage.content === newMessage.content) return;

  const logChannel = await getMessageLogChannel(newMessage.guild);
  if (!logChannel) return;

  const isVoiceChannel = newMessage.channel.isVoiceBased();

  let beforeText;
  let afterText;
  if (oldContentKnown) {
    const diff = buildDiff(oldMessage.content, newMessage.content ?? '');
    beforeText = truncate(diff.before);
    afterText = truncate(diff.after);
  } else {
    beforeText = '*(vorheriger Inhalt nicht im Cache verfügbar)*';
    afterText = truncate(newMessage.content);
  }

  const headerLine = isVoiceChannel
    ? `${newMessage.author} (${newMessage.author.tag}) • [Zur Nachricht](${newMessage.url})`
    : `${newMessage.channel} • ${newMessage.author} (${newMessage.author.tag}) • [Zur Nachricht](${newMessage.url})`;

  const embed = new EmbedBuilder()
    .setTitle('🟡 Nachricht bearbeitet')
    .setDescription(
      [headerLine, '**Vorher:**', asBlockquote(beforeText), '**Nachher:**', asBlockquote(afterText)].join('\n')
    )
    .setColor(EDIT_COLOR)
    .setTimestamp();

  const { files, notes } = await buildAttachmentsSection(newMessage);
  if (notes.length) embed.addFields({ name: 'Medien (nicht wiederhergestellt)', value: notes.join('\n') });

  const target = isVoiceChannel ? await getOrCreateVoiceChannelThread(logChannel, newMessage.channel) : logChannel;
  await target.send({ embeds: [embed], files }).catch(() => {});
}

// Spiegelt jede Nachricht aus einem Voice-Channel-Chat live in dessen Thread im Message-Log -
// die Discord-eigene Chat-Historie eines Voice-Channels verschwindet unwiderruflich, sobald der
// Channel gelöscht wird (z. B. wenn ein temporärer Tisch leerläuft), der Thread bleibt bestehen.
async function mirrorVoiceChannelMessage(message) {
  if (!message.guild || !message.channel.isVoiceBased()) return;
  if (message.author.id === message.client.user.id) return;

  const logChannel = await getMessageLogChannel(message.guild);
  if (!logChannel) return;

  const thread = await getOrCreateVoiceChannelThread(logChannel, message.channel);
  const { files, notes } = await buildAttachmentsSection(message);

  const content = message.content || (message.embeds.length ? '*[Embed]*' : '*[Kein Textinhalt]*');
  const text = notes.length ? `**${message.author.tag}:** ${content}\n${notes.join('\n')}` : `**${message.author.tag}:** ${content}`;

  await thread.send({ content: text, files }).catch(() => {});
}

// Löscht eigene Log-Nachrichten älter als 7 Tage aus einem Channel. Discords bulkDelete
// funktioniert nur für Nachrichten <14 Tage - für den seltenen Fall, dass der Bot länger
// als 14 Tage offline war (Nachrichten also schon älter sind, wenn sie erstmals geprüft
// werden), wird auf einzelnes Löschen zurückgefallen.
async function cleanupChannel(channel, botUserId) {
  const cutoff = Date.now() - RETENTION_MS;
  let lastId;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (batch.size === 0) break;

    const toDelete = batch.filter((m) => m.author.id === botUserId && m.createdTimestamp < cutoff);
    const bulkEligible = toDelete.filter((m) => Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS);
    const tooOldForBulk = toDelete.filter((m) => Date.now() - m.createdTimestamp >= FOURTEEN_DAYS_MS);

    if (bulkEligible.size === 1) {
      await bulkEligible.first().delete().catch(() => {});
    } else if (bulkEligible.size > 1) {
      await channel.bulkDelete(bulkEligible, true).catch(() => {});
    }

    for (const message of tooOldForBulk.values()) {
      await message.delete().catch(() => {});
    }

    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
}

async function cleanupOldMessageLogs(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await getMessageLogChannel(guild);
      if (!channel) continue;

      await cleanupChannel(channel, client.user.id);
    } catch (err) {
      await logError(err, { context: 'Message-Log: alte Einträge aufräumen', guildId: guild.id });
    }
  }
}

function runCleanup(client) {
  cleanupOldMessageLogs(client).catch((err) => logError(err, { context: 'Message-Log-Cleanup' }));
  cleanupExpiredVoiceChannelThreads(client).catch((err) =>
    logError(err, { context: 'Message-Log-Cleanup: Voice-Channel-Threads' })
  );

  try {
    cleanupOldMessageContent(Date.now() - MESSAGE_CONTENT_RETENTION_MS);
  } catch (err) {
    logError(err, { context: 'Message-Log-Cleanup: zwischengespeicherte Nachrichteninhalte' });
  }
}

function startMessageLogCleanup(client) {
  runCleanup(client);
  setInterval(() => runCleanup(client), CLEANUP_INTERVAL_MS);
}

module.exports = {
  logMessageDelete,
  logMessageEdit,
  mirrorVoiceChannelMessage,
  markVoiceChannelDeleted,
  startMessageLogCleanup,
};
