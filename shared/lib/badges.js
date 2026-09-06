// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
function createBadgesStore(db) {
  const upsertBadgeStmt = db.prepare(`
    INSERT INTO badges (key, label, emoji, description) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, emoji = excluded.emoji, description = excluded.description
  `);
  const awardStmt = db.prepare(`
    INSERT INTO user_badges (guild_id, user_id, badge_key, awarded_at, meta) VALUES (?, ?, ?, ?, ?)
  `);
  const hasBadgeStmt = db.prepare(
    'SELECT 1 FROM user_badges WHERE guild_id = ? AND user_id = ? AND badge_key = ? LIMIT 1'
  );
  const totalCountStmt = db.prepare(
    'SELECT COUNT(*) AS count FROM user_badges WHERE guild_id = ? AND user_id = ?'
  );
  const groupedStmt = db.prepare(`
    SELECT
      ub.badge_key AS badgeKey,
      b.label AS label,
      b.emoji AS emoji,
      b.description AS description,
      COUNT(*) AS count,
      MAX(ub.awarded_at) AS lastAwardedAt
    FROM user_badges ub
    LEFT JOIN badges b ON b.key = ub.badge_key
    WHERE ub.guild_id = ? AND ub.user_id = ?
    GROUP BY ub.badge_key
    ORDER BY lastAwardedAt DESC, badgeKey ASC
  `);
  // id als Tiebreaker - awarded_at kann bei zwei Vergaben in derselben Millisekunde gleich sein,
  // ohne id waere die Reihenfolge bei einem Gleichstand undefiniert statt garantiert der zuletzt
  // eingefügten Zeile zu folgen.
  const latestMetaStmt = db.prepare(`
    SELECT meta FROM user_badges
    WHERE guild_id = ? AND user_id = ? AND badge_key = ?
    ORDER BY awarded_at DESC, id DESC LIMIT 1
  `);

  // Gleicht den Badge-Katalog eines Bots ab (Array aus { key, label, emoji, description }) - wie
  // syncInteractionRegistry() in botInteractions.js, hier aber ohne Bereinigung (mehrere Bots
  // könnten künftig eigene Badges beitragen, ein Bot soll die Badges eines anderen nicht löschen).
  function ensureBadgeCatalog(definitions) {
    for (const { key, label, emoji, description } of definitions) {
      upsertBadgeStmt.run(key, label, emoji ?? null, description ?? null);
    }
  }

  // meta ist optionales Zusatz-JSON (z. B. {"month": "2026-12"}) - wird als String gespeichert,
  // beim Lesen nicht automatisch geparst (Aufrufer entscheidet, ob/wie er es braucht).
  function awardBadge(guildId, userId, badgeKey, meta) {
    awardStmt.run(guildId, userId, badgeKey, Date.now(), meta ? JSON.stringify(meta) : null);
  }

  // Für einmalige (nicht wiederholbare) Badges: Vergabe-Logik prüft hiermit selbst, ob der Nutzer
  // das Badge schon hat, bevor sie awardBadge() aufruft - die Tabelle selbst erzwingt das nicht.
  function hasBadge(guildId, userId, badgeKey) {
    return Boolean(hasBadgeStmt.get(guildId, userId, badgeKey));
  }

  function getUserBadgeTotalCount(guildId, userId) {
    return totalCountStmt.get(guildId, userId).count;
  }

  // Ein Eintrag pro Badge-TYP (nicht pro Vergabe) - count/lastAwardedAt fassen alle Wiederholungen
  // zusammen, damit die Liste bei vielen Vergaben desselben Badges (z. B. Gast des Monats über
  // Jahre) nicht unbegrenzt wächst. Für /badges mit Paginierung gedacht.
  function getUserBadgeGroups(guildId, userId) {
    return groupedStmt.all(guildId, userId);
  }

  function getLatestBadgeMeta(guildId, userId, badgeKey) {
    const row = latestMetaStmt.get(guildId, userId, badgeKey);
    if (!row?.meta) return null;
    try {
      return JSON.parse(row.meta);
    } catch {
      return null;
    }
  }

  return {
    ensureBadgeCatalog,
    awardBadge,
    hasBadge,
    getUserBadgeTotalCount,
    getUserBadgeGroups,
    getLatestBadgeMeta,
  };
}

module.exports = createBadgesStore;
