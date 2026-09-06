const { parseSections } = require('./devTicketParser');
const { formatLocalDate } = require('../time/localTime');

// Bleibt deutlich unter Discords 4096-Zeichen-Limit für Embed-Beschreibungen, damit Formatierung
// (Überschriften, Leerzeilen) und ein Sicherheitspuffer nicht knapp werden.
const PAGE_CHAR_BUDGET = 3800;

const STATUS_LABELS = {
  open: 'Offen',
  done: 'Fertiggestellt',
  postponed: 'Zurückgestellt',
  closed: 'Geschlossen',
};

// Visuelle Status-Markierung im Thread-Namen, damit der Status auch in der Kanalliste (ohne
// Klick in den Thread) sofort erkennbar ist.
const STATUS_EMOJI = {
  open: '🟢',
  done: '✅',
  postponed: '⏸️',
  closed: '🔒',
};

// Baut den Thread-Namen aus Status-Emoji + reinem Titel (der Titel selbst ist in der DB separat
// gespeichert, damit der Emoji-Präfix beim Umbenennen bei jedem Statuswechsel sauber ersetzt
// werden kann statt sich vor den Titel zu akkumulieren).
function buildThreadName(status, title) {
  return `${STATUS_EMOJI[status] ?? ''} ${title}`.trim().slice(0, 100);
}

// Holt die komplette Nachrichtenhistorie eines Threads (paginiert über die REST-API, kein
// Gateway-Intent nötig) und behält nur eigene Nachrichten des Bots - die Control-Nachricht mit
// den Status-Buttons wird explizit ausgeklammert, da sie kein inhaltlicher Beitrag ist.
async function fetchOwnMessages(thread, botUserId, controlMessageId) {
  const messages = [];
  let before;

  for (;;) {
    const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    for (const message of batch.values()) {
      if (message.author.id === botUserId && message.id !== controlMessageId) {
        messages.push(message);
      }
    }

    before = batch.last().id;
    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return messages;
}

// Wertet die eigenen Nachrichten eines Tickets aus: Description = Description-Abschnitt der
// zeitlich letzten Nachricht, die einen enthält (unterstützt späteres Überschreiben per
// /message edit). Changelog/Comment-Abschnitte werden nach lokalem Kalendertag gruppiert, in
// chronologischer Reihenfolge innerhalb eines Tages.
function collectTicketContent(messages) {
  let descriptionText = '';
  const byDate = new Map();

  for (const message of messages) {
    const sections = parseSections(message.content);
    if (sections.length === 0) continue;

    const dateStr = formatLocalDate(message.createdTimestamp);
    let bucket = byDate.get(dateStr);

    for (const section of sections) {
      if (!section.text) continue;

      if (section.type === 'description') {
        descriptionText = section.text;
        continue;
      }

      if (!bucket) {
        bucket = { changelog: [], comments: [] };
        byDate.set(dateStr, bucket);
      }

      if (section.type === 'changelog') bucket.changelog.push(section.text);
      else bucket.comments.push(section.text);
    }
  }

  return { descriptionText, byDate };
}

function joinEntries(entries) {
  return entries.join('\n\n');
}

// Baut für jeden Tag (mit für den gewählten Modus relevantem Inhalt) den fertigen Textblock
// ("## <date>" + je nach Modus "### Changelog"/"### Comments"), neuestes Datum zuerst.
function buildDateBlocks(byDate, mode) {
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
  const blocks = [];

  for (const dateStr of dates) {
    const bucket = byDate.get(dateStr);
    const showChangelog = (mode === 'updates' || mode === 'changelog') && bucket.changelog.length > 0;
    const showComments = (mode === 'updates' || mode === 'comments') && bucket.comments.length > 0;
    if (!showChangelog && !showComments) continue;

    let block = `## ${dateStr}`;
    if (showChangelog) block += `\n### Changelog\n${joinEntries(bucket.changelog)}`;
    if (showComments) block += `\n### Comments\n${joinEntries(bucket.comments)}`;
    blocks.push(block);
  }

  return blocks;
}

// Verteilt den Description-Block (nur Seite 1) und die Datums-Blöcke (neuestes zuerst) so auf
// Seiten, dass jede Seite unter dem Zeichen-Budget bleibt - "So viele Tage wie ins Embed passen"
// statt einer festen Tages-/Ticket-Anzahl pro Seite.
function paginateBlocks(threadName, descriptionText, dateBlocks) {
  const titleLine = `# ${threadName}`;
  const descriptionBlock = descriptionText ? `## Description\n${descriptionText}` : null;

  const pages = [];
  let currentParts = descriptionBlock ? [titleLine, descriptionBlock] : [titleLine];
  let currentLength = currentParts.reduce((sum, part) => sum + part.length + 1, 0);
  let hasContentBlock = false;

  for (const block of dateBlocks) {
    const addedLength = block.length + 1;
    if (hasContentBlock && currentLength + addedLength > PAGE_CHAR_BUDGET) {
      pages.push(currentParts.join('\n'));
      currentParts = [titleLine];
      currentLength = titleLine.length + 1;
      hasContentBlock = false;
    }
    currentParts.push(block);
    currentLength += addedLength;
    hasContentBlock = true;
  }

  pages.push(currentParts.join('\n'));
  return pages;
}

async function buildDevTicketInfoPages({ thread, ticket, botUserId, mode }) {
  const messages = await fetchOwnMessages(thread, botUserId, ticket.controlMessageId);
  const { descriptionText, byDate } = collectTicketContent(messages);
  const dateBlocks = buildDateBlocks(byDate, mode);
  const pages = paginateBlocks(thread.name, descriptionText, dateBlocks);
  return { pages, statusLabel: STATUS_LABELS[ticket.status] ?? ticket.status };
}

module.exports = { buildDevTicketInfoPages, STATUS_LABELS, STATUS_EMOJI, buildThreadName };
