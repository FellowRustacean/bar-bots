// LoRA-Adapter "3b_facts_r32_v3" auf Basis Qwen2.5-3B-Instruct - siehe lora/RESULTS.md im
// PC-Repo (Zweitkandidat nach dem Wiederholungs-Fix, E20). Deutlich kleiner als die 7B-
// Empfehlung (facts_p_e3_r32_v3), auf dem Pi potenziell schneller.
//
// WICHTIGER VORBEHALT (siehe RESULTS.md E20, GGUF/Q4-Validierung 3B): unter der tatsaechlichen
// Q4-Quantisierung zeigt dieses Modell einen echten, messbaren Qualitaetsverlust gegenueber
// bf16 (Bleed-Check 30/30 -> 28/30, Wiederholungsrate 0.0% -> 3.7%, Hauptset 90.0% -> 88.0%) -
// beim 7B-Kandidaten trat das NICHT auf. Vor einem Rollout diesen Kandidaten NICHT blind mit
// dem 7B gleichsetzen - noch einmal bewusst pruefen/abwaegen.
//
// BEREITSTELLUNG (noch NICHT auf dem Pi durchgefuehrt):
//   1. lora/v2/gguf/loraval3b_v3-lora.gguf auf den Pi uebertragen.
//   2. `ollama create qwen2.5:3b-facts_r32_v3 -f <Modelfile>` (Basis qwen2.5:3b-instruct -
//      pruefen, ob dieses Basismodell auf dem Pi bereits registriert ist, siehe `ollama list`).
//   3. DIESE Datei nach /home/pi/bots/manager-bot/utils/llm/models/ kopieren.
//   4. /model set qwen2.5:3b-facts_r32_v3
//
// modelName MUSS exakt dem Ollama-Modellnamen entsprechen.

const { buildLoraJsonUserPrompt } = require('./shared');

const systemPrompt = `1920er-Bar-Chat. Du bist der Charakter aus "character".
Mary 34 Managerin (Ex-Eventplanerin) | Quinn 29 Barkeeperin (mit 19 weg, 3 Länder) | Benedict 41 Kellner (15J Butler) | Colt 34 Türsteher (Sicherheitsdienst) | Tony 26 Techniker (Autodidakt) | Jacob 46 Werwolf-Erzähler (Ex-Theater)
Letzte Zeile in "chatverlauf" ist die zu beantwortende Nachricht.
Nur JSON: {"nachricht": "<1-2 kurze Sätze>", "getränk": "<Name>" oder null}
Falsches über dich verneinen. getränk nur bei neuer Bestellung.`;

function parseReply(raw) {
  let parsed;
  try {
    parsed = JSON.parse((raw || '').trim());
  } catch {
    return null;
  }
  const antwort = typeof parsed?.nachricht === 'string' ? parsed.nachricht : null;
  const getraenk = typeof parsed?.['getränk'] === 'string' ? parsed['getränk'].trim() : null;
  return { antwort, getraenk };
}

module.exports = {
  modelName: 'qwen2.5:3b-facts_r32_v3',
  systemPrompt,
  format: 'json',
  buildUserPrompt: buildLoraJsonUserPrompt,
  parseReply,
};
