const createOutboxPoller = require('../../../shared/lib/outboxPoller');
const { createDmSendAction } = require('../../../shared/lib/dmSendAction');
const outboxStore = require('../../storage/outbox');
const { logError } = require('../logs/errorLog');
const { linkDmRelay } = require('../../storage/dmThreads');

module.exports = createOutboxPoller(outboxStore, logError, { dm_send: createDmSendAction({ linkDmRelay }) });
