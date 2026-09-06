// Fabrikfunktion statt fixem require('./db'), damit diese Datei aus dem gemeinsamen shared/lib-
// Ordner heraus für jeden Bot funktioniert - jeder Bot reicht seine eigene, bereits geöffnete
// db-Verbindung rein (siehe storage/outbox.js in jedem Bot-Ordner).
function createOutboxStore(db) {
  function enqueueOutboxMessage({ botName, action, guildId, channelId, messageId, content, title, targetUserId }) {
    const result = db
      .prepare(
        `INSERT INTO outbox_messages (bot_name, action, guild_id, channel_id, message_id, content, title, target_user_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        botName,
        action,
        guildId,
        channelId,
        messageId ?? null,
        content ?? null,
        title ?? null,
        targetUserId ?? null,
        Date.now()
      );

    return result.lastInsertRowid;
  }

  function getOutboxJob(id) {
    return db.prepare('SELECT * FROM outbox_messages WHERE id = ?').get(id);
  }

  // Muss den Claim ATOMAR mit dem Status-Wechsel weg von 'pending' machen (nicht nur lesen) - sonst
  // sieht der naechste Poll-Tick (alle 1s, siehe outboxPoller.js) denselben Job erneut als 'pending',
  // WAEHREND die vorherige async Verarbeitung noch laeuft (setInterval wartet nicht auf die async
  // Callback-Funktion). Bei einer schnellen Einzel-API-Aktion (send/edit/...) war das nie sichtbar,
  // bei mehrstufigen langsamen Aktionen wie 'dm_send' (User fetchen, DM-Channel anlegen, senden,
  // Rueckmeldung posten - mehrere Sekunden) fuehrte genau das zu mehrfachem Versand desselben Jobs.
  // db.transaction() ist bei better-sqlite3 synchron, also race-frei innerhalb dieses Prozesses.
  const claimTransaction = db.transaction((botName) => {
    const rows = db.prepare("SELECT * FROM outbox_messages WHERE bot_name = ? AND status = 'pending'").all(botName);
    const markProcessing = db.prepare("UPDATE outbox_messages SET status = 'processing' WHERE id = ?");
    for (const row of rows) markProcessing.run(row.id);
    return rows;
  });

  function claimPendingOutboxJobs(botName) {
    return claimTransaction(botName);
  }

  function markOutboxJobDone(id, resultMessageId) {
    db.prepare("UPDATE outbox_messages SET status = 'done', result_message_id = ?, processed_at = ? WHERE id = ?").run(
      resultMessageId ?? null,
      Date.now(),
      id
    );
  }

  function markOutboxJobError(id, error) {
    db.prepare("UPDATE outbox_messages SET status = 'error', error = ?, processed_at = ? WHERE id = ?").run(
      String(error).slice(0, 500),
      Date.now(),
      id
    );
  }

  return {
    enqueueOutboxMessage,
    getOutboxJob,
    claimPendingOutboxJobs,
    markOutboxJobDone,
    markOutboxJobError,
  };
}

module.exports = createOutboxStore;
