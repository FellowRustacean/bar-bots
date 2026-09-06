const createInteractionScheduler = require('../../../shared/lib/interactionScheduler');
const store = require('../../storage/botInteractions');
const registry = require('./registry');
const { logError } = require('../logs/errorLog');

module.exports = createInteractionScheduler(store, registry, logError);
