const {
  decayAllPoints,
  getLastDecayDate,
  setLastDecayDate,
} = require('../../storage/warns');
const { startDailyTicker } = require('../../../shared/lib/dailyTicker');

function decayWarnPoints() {
  decayAllPoints();
  console.log('Täglicher Warn-Punkteabbau durchgeführt.');
}

function startWarnDecayTimer() {
  const nextRun = startDailyTicker({
    task: decayWarnPoints,
    getLastRunDate: getLastDecayDate,
    setLastRunDate: setLastDecayDate,
  });

  console.log(`Warn-Punkteabbau gestartet. Nächster Abbau: ${nextRun.toLocaleString()}`);
}

module.exports = {
  decayWarnPoints,
  startWarnDecayTimer,
};
