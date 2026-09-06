// Fabrikfunktion statt fixem require('./db') - siehe botInteractions.js für die Begründung.
// Barkeeper legt Bestellungen an (/snack), Kellner liest fällige Bestellungen aus und liefert sie
// aus - beide Bots nutzen dieselbe gemeinsame Tabelle, kein bot-spezifischer Zustand nötig.
function createSnackOrdersStore(db) {
  const insertStmt = db.prepare(`
    INSERT INTO snack_orders (guild_id, channel_id, user_id, snack_name, deliver_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const dueStmt = db.prepare(`
    SELECT id, guild_id AS guildId, channel_id AS channelId, user_id AS userId, snack_name AS snackName
    FROM snack_orders
    WHERE deliver_at <= ?
  `);
  const deleteStmt = db.prepare('DELETE FROM snack_orders WHERE id = ?');

  function createSnackOrder({ guildId, channelId, userId, snackName, deliverAt }) {
    insertStmt.run(guildId, channelId, userId, snackName, deliverAt, Date.now());
  }

  function getDueSnackOrders(now) {
    return dueStmt.all(now);
  }

  function deleteSnackOrder(id) {
    deleteStmt.run(id);
  }

  return { createSnackOrder, getDueSnackOrders, deleteSnackOrder };
}

module.exports = createSnackOrdersStore;
