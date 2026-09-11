// SQLite kennt kein "ALTER TABLE ... ADD COLUMN IF NOT EXISTS". Der vorherige PRAGMA-Check
// (existiert die Spalte schon?) ist deshalb eine Momentaufnahme - starten zwei Bot-Prozesse fast
// gleichzeitig, können beide "Spalte fehlt noch" lesen, bevor der jeweils andere sie ergänzt hat,
// und dann beide versuchen, dieselbe Spalte hinzuzufügen. Der zweite Versuch schlägt dann mit
// "duplicate column name" fehl - das wird hier gezielt geschluckt, jeder andere Fehler nicht.
function addColumnIfMissing(db, table, column, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

// Einzige Quelle für das Datenbank-Schema der gemeinsamen SQLite-Datei (shared/bot.db). Jeder
// Bot-Prozess ruft applySchema(db) beim eigenen Start selbst auf, mit seiner eigenen offenen
// Verbindung. CREATE TABLE IF NOT EXISTS und addColumnIfMissing() sind für sich genommen bereits
// nebenläufigkeitssicher - aber nicht jede Migration ist das automatisch (z. B. eine, die eine
// Tabelle per CREATE/INSERT SELECT/DROP/RENAME neu aufbaut, siehe die XP-Decimal-Migration unten).
// Starten mehrere Bot-Prozesse (z. B. bei einem Pi-Reboot) fast gleichzeitig, könnten zwei davon
// sonst beide denselben "Migration noch nötig?"-Zustand lesen, bevor der jeweils andere fertig ist,
// und kollidieren. Deshalb läuft applySchema() komplett in EINER BEGIN-IMMEDIATE-Transaktion: die
// erwirbt die Schreibsperre sofort statt erst bei der ersten Änderung, wartet dank
// busy_timeout=5000 (siehe db.js) einfach, falls ein anderer Bot-Prozess gerade dieselbe
// Transaktion offen hat, statt zu kollidieren - und der wartende Prozess sieht danach garantiert
// den bereits vollständig migrierten Stand.
function applySchema(db) {
  db.transaction(() => {
    runSchemaMigrations(db);
  }).immediate();
}

function runSchemaMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_roles (
      guild_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, tier)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tempbans (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      unban_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Merkt sich Username + ID zum Zeitpunkt jedes Banns, solange der Bann aktiv ist (Zeile wird
    -- beim Entbannen wieder gelöscht) - Discords native User-Auswahl zeigt nur aktuelle Mitglieder
    -- an, gebannte Nutzer tauchen dort nicht auf. /unban sucht deshalb hier statt über eine
    -- Erwähnung.
    CREATE TABLE IF NOT EXISTS ban_records (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      banned_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS log_channels (
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, type)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      ticket_channel_id TEXT,
      ticket_category_id TEXT,
      ticket_applications_enabled INTEGER NOT NULL DEFAULT 0,
      ticket_panel_message_id TEXT,
      ticket_counter INTEGER NOT NULL DEFAULT 0,
      voice_channel_id TEXT,
      voice_category_id TEXT,
      afk_channel_id TEXT,
      team_category_id TEXT,
      new_member_role_id TEXT,
      member_role_id TEXT,
      entry_channel_id TEXT,
      entry_message_id TEXT,
      werwolf_category_id TEXT,
      bartresen_channel_id TEXT,
      stammgast_role_id TEXT,
      band_voice_channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
      channel_id TEXT PRIMARY KEY,
      team_channel_id TEXT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      number INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      logging_enabled INTEGER NOT NULL DEFAULT 1
    );

    -- Verknüpft eine Nachricht in einem Ticket-Channel mit ihrer gespiegelten Kopie im jeweils
    -- anderen Channel (siehe relayMessage in ticketActions.js), damit Reaktionen auf einer Seite
    -- auf die passende Nachricht der anderen Seite übertragen werden können. Pro Relay-Paar stehen
    -- zwei Zeilen (eine je Richtung), damit die Zuordnung von jeder Seite aus in O(1) gefunden wird.
    CREATE TABLE IF NOT EXISTS ticket_message_relays (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      paired_message_id TEXT NOT NULL,
      paired_channel_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      creator_id TEXT NOT NULL,
      question TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      closes_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      option_id INTEGER NOT NULL,
      voted_at INTEGER NOT NULL,
      PRIMARY KEY (poll_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS voice_channels (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      table_number INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_preferences (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      remembered INTEGER NOT NULL DEFAULT 0,
      user_limit INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      is_private INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS voice_bans (
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, owner_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS voice_invites (
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, owner_id, user_id)
    );

    -- Wie voice_bans/voice_invites an (guild_id, owner_id) statt an einen konkreten Voice-Channel
    -- gebunden - gilt also automatisch auch fuer den naechsten Tisch desselben Besitzers, kein
    -- erneutes Hinzufuegen noetig. Moderatoren duerfen alle /voice-Subcommands wie der Besitzer
    -- selbst nutzen (siehe voiceCommands.js), ausser den Besitzer bannen/kicken oder andere
    -- Moderatoren verwalten.
    CREATE TABLE IF NOT EXISTS voice_moderators (
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, owner_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS warns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      warn_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      warn_points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    -- XP-Spalten als DECIMAL (SQLite: NUMERIC-Affinität) statt INTEGER, damit künftig auch
    -- gebrochene XP-Werte (z. B. Multiplikator-Events) exakt gespeichert werden können. Wird
    -- überall dort, wo XP angezeigt wird (/rank, /profile, /leaderboard, /xp), gerundet.
    CREATE TABLE IF NOT EXISTS xp (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message_xp DECIMAL NOT NULL DEFAULT 0,
      voice_xp DECIMAL NOT NULL DEFAULT 0,
      bonus_xp DECIMAL NOT NULL DEFAULT 0,
      daily_xp DECIMAL NOT NULL DEFAULT 0,
      daily_date TEXT NOT NULL DEFAULT '',
      monthly_xp DECIMAL NOT NULL DEFAULT 0,
      monthly_month TEXT NOT NULL DEFAULT '',
      last_message_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS hourly_activity (
      guild_id TEXT NOT NULL,
      hour_start INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      messages INTEGER NOT NULL DEFAULT 0,
      voice_minutes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, hour_start, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total_messages INTEGER NOT NULL DEFAULT 0,
      total_voice_minutes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS warn_decay_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_decay_date TEXT NOT NULL
    );

    -- Täglicher Schnappschuss (um Mitternacht) der Mitgliederzahlen für /stats. "Gäste" sind
    -- Nicht-Bot-Mitglieder mit der konfigurierten member-Rolle (über "Die Bar betreten"
    -- verifiziert). "total_tags" ist die Anzahl Nicht-Bot-Mitglieder, die diesen Server aktuell
    -- als Server-Tag (primary guild) eingeblendet haben.
    CREATE TABLE IF NOT EXISTS member_snapshots (
      guild_id TEXT NOT NULL,
      day_start INTEGER NOT NULL,
      total_users INTEGER NOT NULL,
      total_guests INTEGER NOT NULL,
      total_tags INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day_start)
    );

    CREATE TABLE IF NOT EXISTS member_snapshot_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_snapshot_date TEXT NOT NULL
    );

    -- Referral-System: je Nutzer höchstens ein dauerhafter Invite-Link (0 oder 1 Zeile,
    -- daher user_id als Teil des Primärschlüssels statt einer eigenen id-Spalte).
    CREATE TABLE IF NOT EXISTS referral_links (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Wer wurde über wessen Referral-Link geworben. UNIQUE(guild_id, referred_user_id) sorgt
    -- dafür, dass ein Nutzer pro Server nur einmal gezählt wird - verlässt er den Server und
    -- tritt erneut bei (über denselben oder einen anderen Link), zählt weiterhin nur der zuerst
    -- erfasste Beitritt. is_active wechselt nur 0 -> 1, nie zurück (siehe referralActivation.js).
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      referrer_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      active_at INTEGER,
      UNIQUE (guild_id, referred_user_id)
    );

    -- Credit-Zuordnung für Tracks in shared/music - ein Eintrag pro Datei (Pfad relativ zu
    -- shared/music, z. B. "funk/Aces High.mp3"). Nicht jeder Titel in shared/music hat
    -- zwangsläufig eine Zeile hier (z. B. "smooth jazz"/"swing" wurden manuell ergänzt, Quelle/
    -- Lizenz unbekannt) - fehlt ein Eintrag, zeigt /credits entsprechend "keine Angabe" statt
    -- etwas zu erfinden.
    CREATE TABLE IF NOT EXISTS music_credits (
      filename TEXT PRIMARY KEY,
      genre TEXT NOT NULL,
      title TEXT NOT NULL,
      credit_name TEXT NOT NULL,
      credit_url TEXT NOT NULL,
      license TEXT NOT NULL
    );

    -- Genre-Abstimmung im Lounge-Channel: eine Zeile pro Nutzer mit aktiver Stimme (PRIMARY KEY
    -- statt eigener id-Spalte, da ein Nutzer immer höchstens eine Stimme gleichzeitig hat -
    -- erneut abstimmen ersetzt die vorherige Stimme). Wird gelöscht, sobald der Nutzer den
    -- Lounge-Channel verlässt (siehe band bot/utils/band/genreVoting.js).
    CREATE TABLE IF NOT EXISTS band_votes (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      genre TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Skip-Abstimmung fuer den GERADE laufenden Titel - wird bei jedem Titelwechsel (egal ob
    -- natuerliches Ende, /skip, oder Genre-Wechsel durch die Abstimmung) komplett geleert, siehe
    -- bandPlayer.js onTrackChange()-Hook.
    CREATE TABLE IF NOT EXISTS band_skip_votes (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Sterne-Bewertung (1-5) je Nutzer und Titel - bewusst dauerhaft (nicht wie Skip-Votes bei
    -- jedem Titelwechsel geleert), da eine Bewertung fuer den Song an sich gilt, nicht nur fuer
    -- den aktuellen Durchlauf. track ist der Pfad relativ zu shared/music (wie in music_credits).
    CREATE TABLE IF NOT EXISTS band_ratings (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      track TEXT NOT NULL,
      rating INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, track)
    );

    -- Persönliches Entwicklungs-Ticket-System: ein Thread im konfigurierten dev-tickets-Channel
    -- entspricht genau einem Ticket. status: 'open' | 'done' | 'postponed' | 'closed'.
    -- control_message_id ist die Nachricht mit den vier Status-Buttons (Fertiggestellt/Wieder
    -- öffnen/Zurückstellen/Schließen) - wird von /dev-ticket info beim Durchsuchen des Threads
    -- ausgeklammert, da sie kein inhaltlicher Beitrag ist.
    CREATE TABLE IF NOT EXISTS dev_tickets (
      thread_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      control_message_id TEXT,
      created_at INTEGER NOT NULL
    );

    -- Freitext-Zusatzkontext fuers LLM (siehe /model context bei Techniker) - persona_key ist
    -- entweder ein Charakter-Schluessel (z.B. 'kellner') oder 'general' fuer Kontext, der immer
    -- unabhaengig vom angesprochenen Charakter mitgegeben wird.
    CREATE TABLE IF NOT EXISTS llm_persona_context (
      guild_id TEXT NOT NULL,
      persona_key TEXT NOT NULL,
      context TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, persona_key)
    );

    -- Katalog aller Badge-TYPEN (nicht die Vergaben selbst - siehe user_badges). Neue Badges =
    -- neue Zeile hier, keine Schema-Änderung nötig.
    CREATE TABLE IF NOT EXISTS badges (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      emoji TEXT,
      description TEXT
    );

    -- Zuordnungstabelle: welcher Nutzer hat welches Badge wie oft/wann bekommen. Bewusst KEIN
    -- UNIQUE(guild_id, user_id, badge_key) - wiederholbare Badges (z. B. "Gast des Monats" für
    -- mehrere verschiedene Monate) legen für jede Vergabe eine eigene Zeile an, meta hält dafür
    -- z. B. {"month": "2026-12"}. Einmalige Badges müssen ihre eigene Dopplungs-Prüfung vor dem
    -- Award selbst übernehmen (Policy gehört zur jeweiligen Vergabe-Logik, nicht zur Tabelle).
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      badge_key TEXT NOT NULL,
      awarded_at INTEGER NOT NULL,
      meta TEXT
    );

    -- Merkt sich, bis zu welchem Monat monatliche Badge-Vergaben bereits abgearbeitet wurden -
    -- analog zu warn_decay_state/member_snapshot_state, ein gemeinsamer Zustand für den ganzen
    -- Prozess (nicht pro Guild, wie der Rest des Ökosystems aktuell auf einen einzelnen Server
    -- ausgelegt ist). Aktuell von keinem Badge-Typ mehr genutzt (der einzige Nutzer, "Gast des
    -- Monats", wurde entfernt) - bleibt für einen künftigen monatlichen Badge-Typ bestehen, statt
    -- eine Tabelle anzulegen/zu löschen/wieder anzulegen.
    CREATE TABLE IF NOT EXISTS badge_check_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_processed_month TEXT NOT NULL
    );

    -- Generische pro-Channel-Verhaltens-Schalter (aktuell nur "ignore-bots", weitere Optionen
    -- später einfach als neuer flag_key). Ein Eintrag = Flag ist an, kein Eintrag = aus (Standard) -
    -- wie bei stammgast_silence_revoked keine extra "enabled"-Spalte nötig.
    CREATE TABLE IF NOT EXISTS channel_flags (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      set_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id, flag_key)
    );

    -- Ein gemeinsamer Takt für die ganze Bot-Flotte: genau ein next_run_at, egal welcher Bot-
    -- Prozess ihn am Ende zuerst prüft. Das Beanspruchen passiert per bedingtem UPDATE (WHERE
    -- next_run_at = <gelesener Wert>) - läuft der Zufallstakt gerade bei mehreren Bots gleichzeitig
    -- ab, gewinnt nur der Prozess, dessen UPDATE die Zeile noch unverändert vorfindet.
    CREATE TABLE IF NOT EXISTS bot_interaction_schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_run_at INTEGER NOT NULL
    );

    -- Katalog aller registrierten Bot-Interaktionen über die ganze Flotte hinweg. Jeder Bot
    -- gleicht beim eigenen Start seine lokale Registry (utils/botInteractions/registry.js) hierhin
    -- ab - so kann der Bot, der den Zufalls-Takt gewinnt, aus ALLEN Interaktionen wählen, auch
    -- wenn deren tatsächliche Ausführungslogik nur im Code eines anderen Bots existiert.
    CREATE TABLE IF NOT EXISTS bot_interactions (
      key TEXT PRIMARY KEY,
      bot_name TEXT NOT NULL,
      label TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    -- Auftrag "führe Interaktion X aus", adressiert an den Bot, der sie tatsächlich ausführen
    -- kann (analog zu outbox_messages, nur für Interaktionen statt reiner Nachrichten).
    CREATE TABLE IF NOT EXISTS interaction_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_name TEXT NOT NULL,
      interaction_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );

    -- Koordination für die "Team-Päuschen"-Interaktion: mehrere Bots setzen sich gemeinsam an
    -- einen Tisch. Ein Bot (role='leader') geht zuerst in den "Tisch bestellen"-Channel und
    -- bekommt darüber ganz normal (wie ein Mensch) einen neuen Tisch von Kellner zugewiesen -
    -- channel_id ist dabei anfangs NULL und wird erst nachgetragen, sobald der Leader weiß,
    -- welchen Tisch er bekommen hat. Die anderen Bots (role='follower') warten darauf und
    -- betreten anschließend direkt diesen Tisch.
    CREATE TABLE IF NOT EXISTS team_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      trigger_channel_id TEXT NOT NULL,
      channel_id TEXT,
      created_at INTEGER NOT NULL
    );

    -- Ein Eintrag pro teilnehmendem Bot. join_at/leave_at werden bereits beim Anlegen fest
    -- eingeplant (unabhängig zufällig versetzt) - jeder Bot-Prozess prüft per Polling nur noch,
    -- ob für ihn ein fälliger Eintrag vorliegt (siehe teamMeetingPoller.js in jedem der sechs
    -- Bots). joined/left sind einfache Fortschritts-Marker, kein Status-Enum nötig.
    CREATE TABLE IF NOT EXISTS team_meeting_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL,
      bot_name TEXT NOT NULL,
      role TEXT NOT NULL,
      join_at INTEGER NOT NULL,
      leave_at INTEGER NOT NULL,
      joined INTEGER NOT NULL DEFAULT 0,
      left INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      comment TEXT NOT NULL,
      remind_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Barkeeper nimmt die Bestellung entgegen (siehe /snack), Kellner liest fällige Bestellungen
    -- aus derselben Tabelle und liefert sie aus - bot-übergreifend über die gemeinsame DB, ganz
    -- ohne Outbox: hier ist keine "als ein bestimmter Bot senden"-Identität nötig, nur "irgendwann
    -- fällig werden", genau wie bei reminders.
    CREATE TABLE IF NOT EXISTS snack_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      snack_name TEXT NOT NULL,
      deliver_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Kurzlebige eigene Kopie von Nachrichteninhalten, unabhängig vom RAM-Nachrichten-Cache von
    -- discord.js (der bewusst klein gehalten ist, siehe clientCacheOptions.js - max. 50 Nachrichten
    -- pro Channel, 1 Tag Lebensdauer). Wird eine Nachricht gelöscht, NACHDEM sie aus diesem RAM-
    -- Cache gefallen ist, kennt discord.js weder ihren Autor noch Inhalt mehr - ohne diese Tabelle
    -- würde die Löschung dann komplett stillschweigend gar nicht geloggt (siehe messageLog.js).
    -- Absichtlich in der DB statt im RAM (RAM ist die knappe Ressource, Datenbankwachstum nicht) und
    -- mit kurzer eigener Aufbewahrungsfrist (siehe MESSAGE_CONTENT_RETENTION_MS in messageLog.js) -
    -- kein vollständiges Nachrichtenarchiv, nur eine kurze Überbrückung für den Löschungs-Fall.
    CREATE TABLE IF NOT EXISTS recent_message_content (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_tag TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recent_message_content_created_at ON recent_message_content(created_at);

    -- Merkt sich, welcher Thread im Message-Log-Channel den Chat-Mitschnitt eines bestimmten
    -- (meist temporären) Voice-Channels enthält, damit weitere Nachrichten/Bearbeitungen/Löschungen
    -- in denselben Thread einsortiert werden statt jedes Mal einen neuen anzulegen - auch über
    -- Bot-Neustarts hinweg. deleted_at wird gesetzt, sobald der zugehörige Voice-Channel gelöscht
    -- wurde (siehe channelDelete-Handler) - der Thread selbst bleibt danach noch 7 Tage stehen
    -- (dieselbe Aufbewahrungsfrist wie beim übrigen Message-Log) und wird dann per Cleanup entfernt.
    CREATE TABLE IF NOT EXISTS voice_channel_log_threads (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    -- Ein Eintrag = das Stammgast-/silence-Recht wurde diesem Nutzer per /stammgast entzogen.
    -- Kein Eintrag = Recht vorhanden (Standard für jeden mit der Stammgast-Rolle) - so muss beim
    -- Befördern zum Stammgast keine Zeile pro Nutzer vorab angelegt werden.
    CREATE TABLE IF NOT EXISTS stammgast_silence_revoked (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      revoked_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS faq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_actions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, type)
    );

    CREATE TABLE IF NOT EXISTS member_activity (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Jobwarteschlange für bot-übergreifende Nachrichtenaktionen: ein Bot (z. B. Manager) trägt
    -- hier eine Aktion für den Bot ein, der sie tatsächlich als er selbst ausführen soll (z. B.
    -- Werwolf sendet die Nachricht mit seinem eigenen Client), da Discord-Nachrichten nur vom
    -- jeweils authentischen Bot-Account gesendet/bearbeitet werden können.
    -- title wird nur von der 'forum_post'-Aktion genutzt (Titel des neuen Forum-Posts) - bei
    -- 'send'/'edit'/'delete' bleibt es NULL. result_message_id trägt bei 'forum_post' die ID des
    -- neu angelegten Threads statt einer Nachrichten-ID (gleiches Prinzip, andere Bedeutung).
    CREATE TABLE IF NOT EXISTS outbox_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_name TEXT NOT NULL,
      action TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      content TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_message_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );

    -- Ordnet einen im /config-Kanal "dm-channel" angelegten Thread (siehe /dm bei Manager) einem
    -- Bot+Ziel-User zu - beim Erkennen einer neuen Nachricht im Thread ist damit bekannt, als
    -- welcher Charakter sie nach Bestätigung per Discord-DM an wen rausgehen soll.
    CREATE TABLE IF NOT EXISTS dm_threads (
      thread_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Analog zu ticket_message_relays, nur fuer den DM-Thread-Fluss: verknuepft eine Nachricht im
    -- Thread mit ihrem Gegenstueck in der echten DM (und umgekehrt), damit Reaktionen auf einer
    -- Seite auf die passende Nachricht der anderen Seite gespiegelt werden koennen.
    CREATE TABLE IF NOT EXISTS dm_message_relays (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      paired_message_id TEXT NOT NULL,
      paired_channel_id TEXT NOT NULL
    );

    -- Band-Artist-Profile (siehe /artist bei Band): ein Discord-User pro Artist-Profil je Server.
    -- folder_name ist der Name des zugehoerigen Unterordners in shared/music (identisch zu name,
    -- solange /artist rename das nicht auseinanderlaufen laesst - siehe artist.js). Wird genutzt, um
    -- beim Titelwechsel den passenden Artist-Namen fuer die Bot-Umbenennung aufzuloesen.
    CREATE TABLE IF NOT EXISTS artists (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      credit_url TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    -- Rollen, die das LLM (Charakter-Antworten) triggern duerfen (siehe /config llmrole bei
    -- Manager). Mehrere Rollen moeglich (im Unterschied zu /config setrole, das nur je EINE Rolle
    -- pro Funktion kennt) - ist mindestens eine Zeile fuer eine Guild vorhanden, gilt die
    -- Beschraenkung; ist die Guild hier leer, koennen weiterhin alle Nutzer das LLM triggern.
    CREATE TABLE IF NOT EXISTS llm_allowed_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
  `);

  // Migrationsleiste für Spalten, die nach der ersten Version einer Tabelle dazugekommen sind -
  // bei einer frischen Datenbank sind sie durch CREATE TABLE oben bereits vorhanden, bei einer
  // wiederverwendeten (z. B. der ursprünglichen Barkeeper-DB) werden sie hier nachgerüstet.
  const voiceChannelLogThreadsColumns = db.prepare('PRAGMA table_info(voice_channel_log_threads)').all();
  if (!voiceChannelLogThreadsColumns.some((c) => c.name === 'deleted_at')) {
    addColumnIfMissing(db, 'voice_channel_log_threads', 'deleted_at', 'INTEGER');
  }

  const outboxMessagesColumns = db.prepare('PRAGMA table_info(outbox_messages)').all();
  if (!outboxMessagesColumns.some((c) => c.name === 'title')) {
    addColumnIfMissing(db, 'outbox_messages', 'title', 'TEXT');
  }
  if (!outboxMessagesColumns.some((c) => c.name === 'target_user_id')) {
    addColumnIfMissing(db, 'outbox_messages', 'target_user_id', 'TEXT');
  }

  const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all();
  if (!ticketColumns.some((c) => c.name === 'logging_enabled')) {
    addColumnIfMissing(db, 'tickets', 'logging_enabled', 'INTEGER NOT NULL DEFAULT 1');
  }
  if (!ticketColumns.some((c) => c.name === 'team_channel_id')) {
    addColumnIfMissing(db, 'tickets', 'team_channel_id', 'TEXT');
  }

  const guildSettingsColumns = db.prepare('PRAGMA table_info(guild_settings)').all();
  for (const column of [
    'voice_channel_id',
    'voice_category_id',
    'afk_channel_id',
    'team_category_id',
    'new_member_role_id',
    'member_role_id',
    'entry_channel_id',
    'entry_message_id',
    'werwolf_category_id',
    'bartresen_channel_id',
    'stammgast_role_id',
    'band_voice_channel_id',
    'band_vote_message_id',
    'band_skip_message_id',
    'band_player_message_id',
    'dev_tickets_channel_id',
    'active_llm_model',
    'pc_llm_enabled',
  ]) {
    if (!guildSettingsColumns.some((c) => c.name === column)) {
      addColumnIfMissing(db, 'guild_settings', column, 'TEXT');
    }
  }

  const memberSnapshotColumns = db.prepare('PRAGMA table_info(member_snapshots)').all();
  if (!memberSnapshotColumns.some((c) => c.name === 'total_tags')) {
    addColumnIfMissing(db, 'member_snapshots', 'total_tags', 'INTEGER NOT NULL DEFAULT 0');
  }

  // Nachrichten- und Voice-XP werden seit diesem Update getrennt getrackt statt in einer
  // gemeinsamen total_xp-Spalte. Bestehende Gesamt-XP lässt sich rückwirkend nicht aufteilen
  // und wird deshalb komplett in bonus_xp übernommen (zählt weiterhin in die Summe).
  const xpColumns = db.prepare('PRAGMA table_info(xp)').all();
  if (!xpColumns.some((c) => c.name === 'message_xp')) {
    addColumnIfMissing(db, 'xp', 'message_xp', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'xp', 'voice_xp', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'xp', 'bonus_xp', 'INTEGER NOT NULL DEFAULT 0');

    if (xpColumns.some((c) => c.name === 'total_xp')) {
      db.exec('UPDATE xp SET bonus_xp = total_xp');
    }
  }

  // XP-Spalten von INTEGER auf DECIMAL umgestellt (siehe CREATE TABLE oben, für künftige
  // gebrochene XP-Werte, z. B. Multiplikator-Events). SQLite kann den Typ einer bestehenden Spalte
  // nicht per ALTER TABLE ändern - deshalb hier die Tabelle bei Bedarf einmalig neu anlegen und
  // alle Werte 1:1 übernehmen (jeder bisherige INTEGER-Wert ist ein gültiger DECIMAL-Wert, kein
  // Datenverlust). Frisch mit PRAGMA table_info abgefragt statt xpColumns von oben wiederzuverwenden,
  // da die ADD-COLUMN-Migration direkt darüber die Spalten erst gerade angelegt haben könnte.
  const currentXpColumns = db.prepare('PRAGMA table_info(xp)').all();
  const messageXpColumn = currentXpColumns.find((c) => c.name === 'message_xp');
  if (messageXpColumn && messageXpColumn.type === 'INTEGER') {
    db.exec(`
      CREATE TABLE xp_new (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_xp DECIMAL NOT NULL DEFAULT 0,
        voice_xp DECIMAL NOT NULL DEFAULT 0,
        bonus_xp DECIMAL NOT NULL DEFAULT 0,
        daily_xp DECIMAL NOT NULL DEFAULT 0,
        daily_date TEXT NOT NULL DEFAULT '',
        monthly_xp DECIMAL NOT NULL DEFAULT 0,
        monthly_month TEXT NOT NULL DEFAULT '',
        last_message_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      INSERT INTO xp_new (
        guild_id, user_id, message_xp, voice_xp, bonus_xp, daily_xp, daily_date,
        monthly_xp, monthly_month, last_message_at
      )
      SELECT
        guild_id, user_id, message_xp, voice_xp, bonus_xp, daily_xp, daily_date,
        monthly_xp, monthly_month, last_message_at
      FROM xp;
      DROP TABLE xp;
      ALTER TABLE xp_new RENAME TO xp;
    `);
  }

  const voicePreferencesColumns = db.prepare('PRAGMA table_info(voice_preferences)').all();
  if (!voicePreferencesColumns.some((c) => c.name === 'is_private')) {
    addColumnIfMissing(db, 'voice_preferences', 'is_private', 'INTEGER NOT NULL DEFAULT 0');
  }

  const botInteractionsColumns = db.prepare('PRAGMA table_info(bot_interactions)').all();
  if (!botInteractionsColumns.some((c) => c.name === 'weight')) {
    addColumnIfMissing(db, 'bot_interactions', 'weight', 'INTEGER NOT NULL DEFAULT 1');
  }
}

module.exports = { applySchema };
