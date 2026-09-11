// KEIN require('discord.js') hier - shared/lib-Dateien haben bewusst keine eigenen npm-
// Abhaengigkeiten (kein eigenes node_modules), siehe z.B. errorLog.js/statusRotator.js im selben
// Ordner. Discord.js akzeptiert bei components/permissions aber ohnehin rohe, API-konforme
// Objekte/String-Namen genauso wie Builder-Instanzen bzw. die PermissionFlagsBits-Konstanten -
// deshalb hier direkt die rohe API-Struktur statt ActionRowBuilder/ButtonBuilder/PermissionFlagsBits.

const CONFIRM_PREFIX = 'dm_confirm:';
const CANCEL_PREFIX = 'dm_cancel:';
// DM-Versand braucht mehrere sequentielle Discord-API-Calls (User fetchen, DM-Channel anlegen,
// senden) - mehr Luft als generische Einzelschritt-Jobs.
const JOB_WAIT_TIMEOUT_MS = 8000;
const JOB_POLL_INTERVAL_MS = 300;
// Laengstmoegliche Discord-Option, analog zu /dm bei Manager (siehe commands/utility/dm.js) -
// Threads sollen nicht mitten in einer laufenden DM-Konversation von selbst archivieren.
const ARCHIVE_DURATION_MINUTES = 10080; // 7 Tage

function confirmationButtons(messageId) {
  // type 1 = ActionRow, type 2 = Button; style 3 = Success (gruen), style 2 = Secondary (grau) -
  // exakt dieselbe Discord-API-Struktur, die ActionRowBuilder/ButtonBuilder am Ende erzeugen wuerden.
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Senden', custom_id: `${CONFIRM_PREFIX}${messageId}` },
        { type: 2, style: 2, label: 'Verwerfen', custom_id: `${CANCEL_PREFIX}${messageId}` },
      ],
    },
  ];
}

// Fabrikfunktion (analog zu createOutboxStore) - laeuft IDENTISCH in jedem der sieben Bots, jeder
// reicht seinen eigenen botName und seine eigenen, an die gemeinsame DB gebundenen Storage-
// Funktionen rein. Jeder Bot prueft bei einer neuen Nachricht in einem DM-Thread selbst, ob ER der
// im Thread hinterlegte Ziel-Charakter ist (siehe /dm bei Manager) - nur dann wird ueberhaupt aktiv
// geantwortet (die anderen sechs sehen dieselbe Nachricht auch, tun aber nichts). Buttons/Klicks
// landen ohnehin nur beim Bot, der die Nachricht mit den Buttons selbst gepostet hat (Discord
// liefert Interaktionen nur an die Anwendung, der die Nachricht gehoert) - die botName-Pruefung in
// handleButton ist daher nur ein zusaetzliches Sicherheitsnetz, kein tragender Mechanismus.
function createDmThreadFlow({
  botName,
  label,
  getDmThread,
  getDmThreadByTarget,
  createDmThread,
  getLogChannel,
  enqueueOutboxMessage,
  getOutboxJob,
  linkDmRelay,
  getDmRelayPartner,
}) {
  async function waitForJob(jobId) {
    const start = Date.now();
    while (Date.now() - start < JOB_WAIT_TIMEOUT_MS) {
      const job = getOutboxJob(jobId);
      if (job && (job.status === 'done' || job.status === 'error')) return job;
      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    }
    return getOutboxJob(jobId);
  }

  async function handlePotentialDmDraft(message) {
    const hasContent = message.content.trim().length > 0;
    const hasAttachments = message.attachments.size > 0;
    if (message.author.bot || (!hasContent && !hasAttachments)) return;
    if (!message.channel.isThread?.()) return;

    const mapping = getDmThread(message.channelId);
    if (!mapping || mapping.botName !== botName) return;

    const preview = hasContent ? `\n> ${message.content.replaceAll('\n', '\n> ')}` : '';
    const attachmentNote = hasAttachments ? `\n📎 ${message.attachments.size} Anhang/Anhänge werden mitgesendet.` : '';

    await message.reply({
      content: `Als **${label}** an <@${mapping.targetUserId}> senden?${preview}${attachmentNote}`,
      components: confirmationButtons(message.id),
    });
  }

  // Gibt true zurueck, wenn die Interaktion hier verarbeitet wurde (Aufrufer soll dann nicht mehr
  // weiterreichen), sonst false.
  async function handleButton(interaction) {
    const isConfirm = interaction.customId.startsWith(CONFIRM_PREFIX);
    const isCancel = interaction.customId.startsWith(CANCEL_PREFIX);
    if (!isConfirm && !isCancel) return false;

    const mapping = getDmThread(interaction.channelId);
    if (!mapping || mapping.botName !== botName) return false;

    // 'BanMembers' als String-Name statt PermissionFlagsBits.BanMembers - PermissionsBitField#has()
    // akzeptiert beides gleichwertig.
    if (!interaction.member.permissions.has('BanMembers')) {
      await interaction.reply({ content: 'Dafür fehlt dir die Berechtigung.', flags: 64 }); // 64 = MessageFlags.Ephemeral
      return true;
    }

    if (isCancel) {
      await interaction.message.delete().catch(() => {});
      return true;
    }

    const originalMessageId = interaction.customId.slice(CONFIRM_PREFIX.length);
    const originalMessage = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
    if (!originalMessage) {
      await interaction.update({ content: '⚠️ Ursprüngliche Nachricht wurde nicht mehr gefunden.', components: [] });
      return true;
    }

    await interaction.update({ content: '⏳ Wird gesendet...', components: [] });

    // Anhaenge (Bilder/Dateien) als JSON-Array von URLs im 'title'-Feld mitschicken - die
    // dm_send-Aktion (siehe shared/lib/dmSendAction.js) reicht sie an dm.send() weiter.
    const attachmentUrls = [...originalMessage.attachments.values()].map((a) => a.url);

    const jobId = enqueueOutboxMessage({
      botName: mapping.botName,
      action: 'dm_send',
      guildId: mapping.guildId,
      channelId: interaction.channelId,
      messageId: originalMessage.id,
      content: originalMessage.content,
      title: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null,
      targetUserId: mapping.targetUserId,
    });

    const job = await waitForJob(jobId);

    // Bestaetigungs-Nachricht raeumt sich in JEDEM Fall selbst weg (erledigt/nicht mehr aktionabel)
    // - ein Zustellungsfehler wird trotzdem als eigene Nachricht im Thread gemeldet (siehe
    // dmSendAction.js).
    await interaction.message.delete().catch(() => {});

    // result_message_id ist nur bei tatsaechlich zugestellter DM gesetzt (siehe dmSendAction.js) -
    // bei einem Zustellungsfehler bleibt es null, auch wenn der Job als 'done' markiert wurde.
    if (job?.result_message_id) {
      // Transparenz-/Nachvollziehbarkeits-Log: eigene, vom BOT selbst verfasste Nachricht (nicht die
      // urspruengliche Entwurfs-Nachricht des Mods) - haelt WER (interaction.user) WAS als WELCHER
      // Charakter an WEN gesendet hat fest. Erst NACH erfolgreichem Posten dieses Logs wird die
      // urspruengliche Entwurfs-Nachricht geloescht - der Inhalt bleibt so immer nachvollziehbar
      // im Bot-Log erhalten, selbst wenn der Mod versuchen wuerde, seine eigene Nachricht zu
      // loeschen, um etwas zu verbergen.
      const preview = originalMessage.content ? `\n> ${originalMessage.content.replaceAll('\n', '\n> ')}` : '';
      const logged = await interaction.channel
        .send({
          content: `✅ **${interaction.user.tag}** hat als **${label}** an <@${mapping.targetUserId}> gesendet:${preview}`,
          files: attachmentUrls.length > 0 ? attachmentUrls : undefined,
        })
        .catch(() => null);

      if (logged) await originalMessage.delete().catch(() => {});
    }

    return true;
  }

  // Eingehende DM: der User eroeffnet das Gespraech selbst, statt dass Personal ueber /dm startet.
  // Legt (falls noch nicht vorhanden) denselben Thread-Typ im dm-channel an und spiegelt die
  // Nachricht dort rein - reine Sichtbarkeit fuer Personal, kein Bestaetigungsfluss noetig (der User
  // hat ja schon selbst gesendet). Antworten darauf laufen wieder ganz normal ueber den bestehenden
  // Thread-Bestaetigungsfluss (handlePotentialDmDraft/handleButton).
  async function handleIncomingUserDm(message) {
    if (message.author.bot || message.guild) return; // nur echte DMs, keine Server-Nachrichten

    let mapping = getDmThreadByTarget(botName, message.author.id);

    if (!mapping) {
      const guild = message.client.guilds.cache.first();
      if (!guild) return;

      const dmChannelId = getLogChannel(guild.id, 'dm-channel');
      if (!dmChannelId) return; // kein DM-Kanal konfiguriert - nichts zu tun

      const dmChannel = await guild.channels.fetch(dmChannelId).catch(() => null);
      if (!dmChannel || !dmChannel.isTextBased()) return;

      const thread = await dmChannel.threads.create({
        name: `${label} ↔ ${message.author.username}`.slice(0, 100),
        autoArchiveDuration: ARCHIVE_DURATION_MINUTES,
        reason: `${message.author.tag} hat zuerst per DM geschrieben`,
      });

      createDmThread(thread.id, guild.id, botName, message.author.id);
      mapping = { threadId: thread.id, guildId: guild.id, botName, targetUserId: message.author.id };
    }

    const thread = await message.client.channels.fetch(mapping.threadId).catch(() => null);
    if (!thread) return;

    const preview = message.content.trim() ? `\n> ${message.content.replaceAll('\n', '\n> ')}` : '';
    const attachmentUrls = [...message.attachments.values()].map((a) => a.url);

    const mirrored = await thread
      .send({
        content: `📩 **${message.author.tag}** hat per DM geschrieben:${preview}`,
        files: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      })
      .catch(() => null);

    // Verknuepfung merken, damit Reaktionen auf einer Seite (DM oder Thread-Spiegel) auf die
    // passende Nachricht der anderen Seite uebertragen werden koennen (siehe handleReactionAdd/-Remove).
    if (mirrored) linkDmRelay(message.id, message.channelId, mirrored.id, mirrored.channelId);
  }

  // Spiegelt eine Reaktion von einer Seite (DM-Nachricht oder Thread-Kopie) auf die verknuepfte
  // Nachricht der anderen Seite - analog zu relayTicketReactionAdd in ticketActions.js, hier aber
  // fuer beliebige Kanaltypen (DM-Channel ODER Guild-Thread), da client.channels.fetch() beides
  // gleichermassen aufloest.
  async function resolveRelayPartner(reaction) {
    if (reaction.partial) {
      reaction = await reaction.fetch().catch(() => null);
      if (!reaction) return null;
    }
    if (reaction.message.partial) {
      const fullMessage = await reaction.message.fetch().catch(() => null);
      if (!fullMessage) return null;
    }

    const partner = getDmRelayPartner(reaction.message.id);
    if (!partner) return null;

    const partnerChannel = await reaction.message.client.channels.fetch(partner.channelId).catch(() => null);
    if (!partnerChannel) return null;

    const partnerMessage = await partnerChannel.messages.fetch(partner.messageId).catch(() => null);
    return partnerMessage ? { reaction, partnerMessage } : null;
  }

  async function handleReactionAdd(reaction, user) {
    if (user.bot) return;

    const resolved = await resolveRelayPartner(reaction);
    if (!resolved) return;

    await resolved.partnerMessage.react(resolved.reaction.emoji.identifier).catch(() => {});
  }

  // Entfernt die gespiegelte Reaktion nur, wenn auf der Quellseite jetzt niemand mehr mit diesem
  // Emoji reagiert - sonst wuerde das Entfernen einer einzelnen Reaktion (z.B. von einem von
  // mehreren Team-Mitgliedern im Thread) die gespiegelte Reaktion auf der DM-Seite komplett
  // verschwinden lassen, obwohl andere noch reagiert haben.
  async function handleReactionRemove(reaction, user) {
    if (user.bot) return;

    const resolved = await resolveRelayPartner(reaction);
    if (!resolved) return;

    if ((resolved.reaction.count ?? 0) > 0) return;

    const emojiKey = resolved.reaction.emoji.id ?? resolved.reaction.emoji.name;
    const partnerReaction = resolved.partnerMessage.reactions.cache.get(emojiKey);
    if (partnerReaction) await partnerReaction.users.remove(resolved.partnerMessage.client.user.id).catch(() => {});
  }

  return { handlePotentialDmDraft, handleButton, handleIncomingUserDm, handleReactionAdd, handleReactionRemove };
}

module.exports = { createDmThreadFlow };
