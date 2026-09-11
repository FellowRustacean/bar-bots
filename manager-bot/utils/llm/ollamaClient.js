// Nur noch der Pi - die PC/14B-Anbindung (Probe + Fallback) wurde auf Nutzerwunsch komplett
// entfernt, es wird nie mehr versucht, den PC zu erreichen (siehe Session-Historie).
const PI_URL = 'http://127.0.0.1:11434';
// Aktives Modell auf dem Pi (siehe /model set bei Techniker, bleibt dauerhaft geladen -
// OLLAMA_KEEP_ALIVE=-1). Dieser Fallback-Wert greift nur, wenn kein aktives Modell in der DB
// gesetzt ist.
const DEFAULT_MODEL = 'qwen2.5:7b-instruct';

// Groesser als das 4096-Token-Budget, das fuer den zusammengebauten Prompt anvisiert wird (siehe
// chatOrchestrator.js) - laesst Luft fuer die Antwort selbst, sonst muesste Ollama sonst intern
// aeltere Prompt-Tokens verwerfen, sobald das Fenster voll ist.
const DEFAULT_NUM_CTX = 6144;

// Eigener, PROZESS-lokaler Exklusiv-Zugriff (analog zu Techniker's ollamaClient) - schuetzt davor,
// dass Manager selbst mehrere Chat-Generierungen gleichzeitig anstoesst (z.B. wenn kurz hintereinander
// mehrere Nachrichten in verschiedenen Kanaelen triggern). Kann NICHT verhindern, dass Techniker
// zeitgleich per /model pull auf denselben Ollama-Prozess zugreift (getrennter Prozess, eigener
// Speicher) - Ollama serialisiert Anfragen pro Modell aber ohnehin selbst intern, das reicht als
// Sicherheitsnetz fuer den Pi.
let busy = false;

// Liefert Ziel-URL + Modell fuer diesen Aufruf - immer der Pi, kein Probe-Roundtrip mehr noetig.
// Oeffentlich (siehe module.exports), damit chatOrchestrator.js das Ziel EINMAL pro Runde aufloesen
// kann statt pro Charakter neu.
async function resolveTarget(model) {
  return { baseUrl: PI_URL, model: model ?? DEFAULT_MODEL, isPc: false };
}

async function postChat(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/chat`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama /api/chat: HTTP ${res.status}`);
  return res.json();
}

// Wie chat(), nutzt aber ein BEREITS aufgeloestes Ziel (siehe resolveTarget) statt bei jedem Aufruf
// erneut aufzuloesen - spart nichts Nennenswertes mehr seit der PC-Anbindung entfernt wurde, bleibt
// aber als Struktur bestehen (mehrere Charaktere in derselben Runde teilen sich EIN Ziel).
async function chatWithTarget(system, userContent, target, { format, temperature = 0.4, numCtx = DEFAULT_NUM_CTX, numPredict } = {}) {
  if (busy) throw new Error('Lokales LLM ist gerade mit einer anderen Anfrage beschaeftigt.');
  busy = true;
  try {
    const body = {
      model: target.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      stream: false,
      ...(format ? { format } : {}),
      options: {
        temperature,
        repeat_penalty: 1.2,
        num_ctx: numCtx,
        // Nur fuer measureAndCacheSystemBaseline() gesetzt (siehe unten) - spart Generierungszeit
        // bei einem Call, der nur die Prompt-Tokenzahl interessiert, nicht die eigentliche Antwort.
        ...(numPredict != null ? { num_predict: numPredict } : {}),
      },
    };

    const data = await postChat(target.baseUrl, body);

    // Ollamas volle Aufschluesselung (ns->ms): ms = total_duration (alles zusammen, inkl. eventueller
    // Modell-Ladezeit), promptEvalMs = prompt_eval_duration (reines Prompt-Einlesen/Prefill),
    // evalMs = eval_duration (reine Textgenerierung). Erst alle drei zusammen zeigen, WORAN eine
    // lange Antwortzeit tatsaechlich liegt (siehe llmLog.js) - ms allein sagt nur "insgesamt so
    // lange", promptEvalMs+evalMs koennen zusammen kleiner als ms sein (Rest = Modell-Ladezeit).
    const promptEvalMs = data.prompt_eval_duration != null ? Math.round(data.prompt_eval_duration / 1e6) : null;
    const evalMs = data.eval_duration != null ? Math.round(data.eval_duration / 1e6) : null;
    // Echte Tokenzahlen von Ollama (nicht die ~4-Zeichen/Token-Schaetzung) - inputTokens = gesamter
    // Prompt (System+User zusammen, wie ihn das Modell tatsaechlich sieht), outputTokens = generierte
    // Antwort. Wie viel davon aus dem Prompt-Cache kam (siehe Session-Debugging: "cached n_tokens"),
    // gibt die API selbst nicht her - nur die Ollama-Server-Logs zeigen das.
    const inputTokens = data.prompt_eval_count ?? null;
    const outputTokens = data.eval_count ?? null;
    return { data, ms: Math.round(data.total_duration / 1e6), promptEvalMs, evalMs, inputTokens, outputTokens, model: target.model, isPc: false };
  } finally {
    busy = false;
  }
}

async function chat(system, userContent, model) {
  const target = await resolveTarget(model);
  const { data, ms, promptEvalMs, evalMs, model: usedModel, isPc } = await chatWithTarget(system, userContent, target);
  return { text: data.message.content.trim(), ms, promptEvalMs, evalMs, model: usedModel, isPc };
}

// Statt einen echten Tokenizer einzubauen (siehe Session-Debugging, waere ein neuer, ziemlich
// schwerer JS/WASM-Dependency-Zweig fuer den Pi): misst per Differenz gegen Ollamas EIGENEN,
// echten Tokenizer - EINMAL pro exaktem System-Prompt-Text (Cache-Key = der Text selbst; aendert
// sich der System-Prompt inhaltlich, z.B. durch /model context, greift automatisch ein neuer
// Cache-Eintrag statt eines veralteten Werts). "Input-Tokens des echten Calls minus dieser
// Baseline" ergibt dann in llmLog.js die echte User-Prompt-Tokenzahl - keine Schaetzung mehr.
const systemBaselineCache = new Map();

function getCachedSystemBaseline(system) {
  return systemBaselineCache.get(system) ?? null;
}

// Wird in chatOrchestrator.js bewusst ABGEWARTET (nicht fire-and-forget) - teilt sich die "busy"-
// Sperre oben mit echten Anfragen, siehe dortiger Kommentar. userContent ist bewusst leer (kein
// zusaetzlicher Inhalt, der die Baseline verfaelschen wuerde), num_predict:1 minimiert die
// Generierungszeit (nur die Prompt-Verarbeitung liefert den interessanten Wert).
async function measureAndCacheSystemBaseline(system, target) {
  if (systemBaselineCache.has(system)) return systemBaselineCache.get(system);
  const { inputTokens } = await chatWithTarget(system, '', target, { numPredict: 1 });
  if (inputTokens != null) systemBaselineCache.set(system, inputTokens);
  return inputTokens;
}

module.exports = { chat, resolveTarget, chatWithTarget, DEFAULT_MODEL, getCachedSystemBaseline, measureAndCacheSystemBaseline };
