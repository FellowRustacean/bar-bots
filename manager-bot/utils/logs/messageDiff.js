const { diffWords } = require('diff');

function buildDiff(oldText, newText) {
  const parts = diffWords(oldText, newText);
  let before = '';
  let after = '';

  for (const part of parts) {
    if (part.added) {
      after += `**${part.value}**`;
    } else if (part.removed) {
      before += `~~${part.value}~~`;
    } else {
      before += part.value;
      after += part.value;
    }
  }

  return {
    before: before || '*Kein Textinhalt*',
    after: after || '*Kein Textinhalt*',
  };
}

module.exports = { buildDiff };
