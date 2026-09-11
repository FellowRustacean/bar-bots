// Fabrikfunktion statt fixem require('./db'), damit diese Datei aus dem gemeinsamen shared/lib-
// Ordner heraus für jeden Bot funktioniert - jeder Bot reicht seine eigene, bereits geöffnete
// db-Verbindung rein (siehe storage/botInteractions.js in jedem Bot-Ordner).
function createBotInteractionsStore(db) {
  const getScheduleStmt = db.prepare('SELECT next_run_at AS nextRunAt FROM bot_interaction_schedule WHERE id = 1');
  const insertScheduleStmt = db.prepare('INSERT INTO bot_interaction_schedule (id, next_run_at) VALUES (1, ?)');
  const claimUpdateStmt = db.prepare(
    'UPDATE bot_interaction_schedule SET next_run_at = ? WHERE id = 1 AND next_run_at = ?'
  );
  const resetScheduleStmt = db.prepare(`
    INSERT INTO bot_interaction_schedule (id, next_run_at) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET next_run_at = excluded.next_run_at
  `);

  const upsertInteractionStmt = db.prepare(`
    INSERT INTO bot_interactions (key, bot_name, label, weight, enabled) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET bot_name = excluded.bot_name, label = excluded.label, weight = excluded.weight, enabled = 1
  `);
  const deleteStaleInteractionsStmt = db.prepare(
    `DELETE FROM bot_interactions WHERE bot_name = ? AND key NOT IN (SELECT value FROM json_each(?))`
  );
  const getEnabledInteractionsStmt = db.prepare(
    'SELECT key, bot_name AS botName, label, weight FROM bot_interactions WHERE enabled = 1'
  );

  const enqueueJobStmt = db.prepare(
    'INSERT INTO interaction_jobs (bot_name, interaction_key, status, created_at) VALUES (?, ?, \'pending\', ?)'
  );
  const claimPendingJobsSelectStmt = db.prepare(
    "SELECT id, bot_name AS botName, interaction_key AS interactionKey FROM interaction_jobs WHERE bot_name = ? AND status = 'pending'"
  );
  const markRunningStmt = db.prepare("UPDATE interaction_jobs SET status = 'running' WHERE id = ?");
  const markJobStmt = db.prepare('UPDATE interaction_jobs SET status = ?, error = ?, processed_at = ? WHERE id = ?');
  const getJobStmt = db.prepare(
    'SELECT id, bot_name AS botName, interaction_key AS interactionKey, status, error FROM interaction_jobs WHERE id = ?'
  );

  // 60-240 Minuten in ms, zufällig - siehe Anforderung: EIN gemeinsamer Takt für die ganze Flotte.
  function randomIntervalMs() {
    const minutes = 60 + Math.random() * (240 - 60);
    return Math.round(minutes * 60 * 1000);
  }

  // Prüft, ob der gemeinsame Takt fällig ist, und beansprucht ihn bei Fälligkeit atomar für den
  // aufrufenden Prozess (per bedingtem UPDATE). Gibt true zurück, wenn DIESER Aufruf gewonnen hat
  // und eine Interaktion auslösen darf - sonst false (noch nicht fällig, oder ein anderer Prozess
  // war schneller).
  function claimScheduledRun() {
    const now = Date.now();
    const row = getScheduleStmt.get();

    if (!row) {
      // Erstinitialisierung: noch nie geplant - direkt einen ersten Zeitpunkt in der Zukunft
      // setzen, nicht sofort beim allerersten Bot-Start feuern.
      insertScheduleStmt.run(now + randomIntervalMs());
      return false;
    }

    if (row.nextRunAt > now) return false;

    const result = claimUpdateStmt.run(now + randomIntervalMs(), row.nextRunAt);
    return result.changes === 1;
  }

  // Reiner Lesezugriff auf den nächsten geplanten Zeitpunkt, ohne ihn zu beanspruchen/verändern -
  // für "/interaction next" (zeigt nur die verbleibende Zeit an, löst nichts aus).
  function getNextRunAt() {
    return getScheduleStmt.get()?.nextRunAt ?? null;
  }

  // Setzt den gemeinsamen Takt unbedingt auf einen neuen zufälligen Zeitpunkt (60-240 Min. ab
  // jetzt) - anders als claimScheduledRun() unabhängig davon, ob er gerade fällig ist. Für den
  // manuellen "/interaction"-Testbefehl: eine sofort ausgelöste Interaktion soll den nächsten
  // regulären Zufallslauf verschieben, nicht zusätzlich zu ihm auftreten.
  function resetSchedule() {
    resetScheduleStmt.run(Date.now() + randomIntervalMs());
  }

  // Gleicht die lokale Registry eines Bots (Array aus { key, label, weight }) in den gemeinsamen
  // Katalog ab. Einträge, die lokal nicht mehr existieren (z. B. eine Interaktion wurde entfernt),
  // werden für DIESEN Bot bereinigt - andere Bots' Einträge bleiben unangetastet. Fehlt weight,
  // gilt 1 (Standard-Gewicht).
  function syncInteractionRegistry(botName, registry) {
    for (const { key, label, weight } of registry) {
      upsertInteractionStmt.run(key, botName, label, weight ?? 1);
    }
    deleteStaleInteractionsStmt.run(botName, JSON.stringify(registry.map((entry) => entry.key)));
  }

  function getEnabledInteractions() {
    return getEnabledInteractionsStmt.all();
  }

  function enqueueInteractionJob(botName, interactionKey) {
    const result = enqueueJobStmt.run(botName, interactionKey, Date.now());
    return result.lastInsertRowid;
  }

  function getInteractionJob(id) {
    return getJobStmt.get(id) ?? null;
  }

  // Markiert beanspruchte Jobs SOFORT als 'running' (statt erst nach Abschluss von run()), damit
  // ein lange laufender run() (z. B. mehrere Tische mit 30-60s Pause dazwischen) nicht beim
  // nächsten Poll-Tick (alle 5s) erneut als 'pending' erkannt und doppelt ausgeführt wird.
  function claimPendingInteractionJobs(botName) {
    const jobs = claimPendingJobsSelectStmt.all(botName);
    for (const job of jobs) markRunningStmt.run(job.id);
    return jobs;
  }

  function markInteractionJobDone(id) {
    markJobStmt.run('done', null, Date.now(), id);
  }

  function markInteractionJobSkipped(id) {
    markJobStmt.run('skipped', null, Date.now(), id);
  }

  function markInteractionJobError(id, error) {
    markJobStmt.run('error', String(error).slice(0, 500), Date.now(), id);
  }

  return {
    claimScheduledRun,
    getNextRunAt,
    resetSchedule,
    syncInteractionRegistry,
    getEnabledInteractions,
    enqueueInteractionJob,
    getInteractionJob,
    claimPendingInteractionJobs,
    markInteractionJobDone,
    markInteractionJobSkipped,
    markInteractionJobError,
  };
}

module.exports = createBotInteractionsStore;
