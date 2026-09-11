function parseDuration(input) {
  const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i.exec(input.trim());
  if (!match) return null;

  const [, days, hours, minutes] = match;
  if (!days && !hours && !minutes) return null;

  const ms =
    (parseInt(days || '0', 10) * 86400 +
      parseInt(hours || '0', 10) * 3600 +
      parseInt(minutes || '0', 10) * 60) *
    1000;

  return ms;
}

module.exports = { parseDuration };
