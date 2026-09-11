const createOutboxStore = require('../../shared/lib/outbox');
const db = require('./db');

module.exports = createOutboxStore(db);
