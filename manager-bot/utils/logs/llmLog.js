const { AttachmentBuilder } = require('discord.js');
const { getLogChannel } = require('../../storage/guildConfig');

// Discord-Nachrichtenlimit (Plain-Text, kein Embed mehr) - Puffer fuer Header/Codeblock-Markup
// wird pro Aufruf von der Textlaenge abgezogen. Gilt nur noch fuer die Output-Nachricht (kurz,
// passt praktisch immer) - der Input-Prompt geht als .txt-Anhang raus (siehe sendPromptFile),
// kein 2000-Zeichen-Limit mehr, seit Kontext/Beispiele den Prompt deutlich laenger machen koennen.
const DISCORD_MESSAGE_LIMIT = 2000;
const CODEBLOCK_MARKUP_LENGTH = 8; // "```\n" + "\n```"

function jumpLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// Grobe Schaetzung (kein echter Tokenizer verfuegbar) - dieselbe ~4-Zeichen/Token-Faustregel wie
// in chatOrchestrator.js (dort nicht importiert, um keine Kopplung an dessen internen Aufbau
// einzugehen - reine 1-Zeilen-Formel, Duplizierung ist hier unproblematisch).
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function buildHeader(
  kind,
  { label, guildId, channelId, messageId, text, usedModel, isPc, durationMs, promptEvalMs, evalMs, systemTokenEstimate, inputTokens, outputTokens }
) {
  const location = isPc ? 'PC' : 'Pi';
  const modelInfo = usedModel ? ` · ${usedModel} (${location})` : '';
  const durationInfo = durationMs != null ? ` · Gesamt: ${durationMs}ms` : '';
  // Aufschluesselung wie in den lokalen Pi-Tests (siehe Session-Debugging): Prefill (Prompt
  // einlesen) und Generierung sind oft sehr unterschiedlich teuer - durationMs (Gesamt) allein
  // verschleiert das. Liegt durationMs deutlich ueber promptEvalMs+evalMs, steckt die Differenz in
  // Modell-Ladezeit (siehe ollamaClient.js).
  const promptEvalInfo = promptEvalMs != null ? ` · Prefill: ${promptEvalMs}ms` : '';
  const evalInfo = evalMs != null ? ` · Generierung: ${evalMs}ms` : '';

  // Echte Ollama-Tokenzahlen statt der ~4-Zeichen-Schaetzung, wo verfuegbar - inputTokens ist der
  // GESAMTE Prompt (System+User), wie ihn Ollama tatsaechlich gezaehlt hat; systemTokenEstimate
  // bleibt eine Schaetzung (der statische Charakter-Roster-Teil wird nie isoliert an Ollama
  // geschickt, dafuer gibt es keine echte Tokenzahl - siehe Session-Debugging zum Prompt-Cache).
  let tokenInfo;
  if (inputTokens != null) {
    const systemInfo = systemTokenEstimate != null ? ` (~${systemTokenEstimate} davon System-Roster)` : '';
    tokenInfo = ` · Input: ${inputTokens} Tokens${systemInfo}`;
  } else if (outputTokens != null) {
    tokenInfo = ` · Output: ${outputTokens} Tokens`;
  } else {
    tokenInfo = ` · ~${estimateTokens(text)} Tokens`;
  }

  return `**LLM ${kind}** · ${label}${modelInfo}${tokenInfo}${durationInfo}${promptEvalInfo}${evalInfo} · ${jumpLink(guildId, channelId, messageId)}`;
}

// Der Input-Prompt kann inzwischen deutlich laenger als 2000 Zeichen sein (Kontext + Beispiel-
// Konversation + Verlauf) - als .txt-Anhang gibt es keine Kuerzung mehr, der komplette Prompt
// bleibt einsehbar statt nur ein abgeschnittener Auszug.
async function sendPromptFile(logChannel, context) {
  const header = buildHeader('Input', context);
  const attachment = new AttachmentBuilder(Buffer.from(context.text, 'utf-8'), { name: 'prompt.txt' });

  await logChannel.send({ content: header, files: [attachment] }).catch(() => {});
}

// Die Modell-Antwort ist normalerweise kurz (max. 1-2 Saetze pro Charakter) - bleibt als
// Codeblock-Nachricht, kein Anhang noetig.
async function sendResponseMessage(logChannel, context) {
  const header = `${buildHeader('Output', context)}\n`;
  const maxBodyLength = DISCORD_MESSAGE_LIMIT - header.length - CODEBLOCK_MARKUP_LENGTH;
  const body = context.text.length > maxBodyLength ? `${context.text.slice(0, maxBodyLength - 1)}…` : context.text;

  await logChannel.send({ content: `${header}\`\`\`\n${body}\n\`\`\`` }).catch(() => {});
}

// Protokolliert JEDEN einzelnen LLM-Call (siehe respondAsSinglePersona in chatOrchestrator.js) roh
// - je EINE Nachricht fuer den kompletten Input-Prompt (als .txt-Anhang) und EINE fuer die rohe
// Modell-Antwort (vor jeglichem Praefix-Stripping, als Codeblock). Bei mehreren angesprochenen
// Charakteren also entsprechend mehr Nachrichten (mind. 2 pro Charakter). Die ID der ausloesenden
// Discord-Nachricht dient als Referenz/Verlinkung statt einer eigenen Log-ID.
async function logLlmCall(
  guild,
  { message, persona, promptText, responseText, usedModel, isPc, ms, promptEvalMs, evalMs, systemTokenEstimate, inputTokens, outputTokens }
) {
  const logChannelId = getLogChannel(guild.id, 'llm');
  if (!logChannelId) return;

  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const context = { label: persona.displayName, guildId: guild.id, channelId: message.channelId, messageId: message.id, usedModel, isPc };
  // Input-Tokenzahlen (System-Schaetzung + echtes Gesamt) auf der Input-Nachricht, Zeiten +
  // Output-Tokenzahl auf der Output-Nachricht - jeweils dort, wo sie inhaltlich hingehoeren.
  await sendPromptFile(logChannel, { ...context, text: promptText, systemTokenEstimate, inputTokens });
  await sendResponseMessage(logChannel, { ...context, text: responseText, durationMs: ms, promptEvalMs, evalMs, outputTokens });
}

// Testphase (siehe chatOrchestrator.js runShadowClassification): protokolliert den JA/NEIN-
// Klassifizierungs-Call genau wie logLlmCall, nur mit einem eigenen Label (statt Charakter-Name,
// da vor der Klassifizierung noch gar nicht feststeht, welcher/ob ueberhaupt ein Charakter
// antworten wuerde) und der gemessenen Dauer im Header, damit sich das direkt im Log-Kanal
// nachvollziehen laesst, ohne die Konsole/den Rohcode einsehen zu muessen.
async function logLlmClassification(guild, { message, promptText, responseText, classification, durationMs, usedModel, isPc }) {
  const logChannelId = getLogChannel(guild.id, 'llm');
  if (!logChannelId) return;

  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const context = {
    label: `Gate-Test (${classification})`,
    guildId: guild.id,
    channelId: message.channelId,
    messageId: message.id,
    usedModel,
    isPc,
    durationMs,
  };
  await sendPromptFile(logChannel, { ...context, text: promptText });
  await sendResponseMessage(logChannel, { ...context, text: responseText });
}

module.exports = { logLlmCall, logLlmClassification };
