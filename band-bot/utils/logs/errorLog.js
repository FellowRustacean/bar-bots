const createErrorLog = require('../../../shared/lib/errorLog');
const { getLogChannel } = require('../../storage/guildConfig');

module.exports = createErrorLog(getLogChannel);
