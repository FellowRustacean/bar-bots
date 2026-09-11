const createBotInteractionsStore = require('../../shared/lib/botInteractions');
const db = require('./db');

module.exports = createBotInteractionsStore(db);
