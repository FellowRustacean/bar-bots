const createOutboxPoller = require('../../../shared/lib/outboxPoller');
const outboxStore = require('../../storage/outbox');
const { logError } = require('../logs/errorLog');

module.exports = createOutboxPoller(outboxStore, logError);
