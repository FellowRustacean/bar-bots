# Entwicklungslog LLM-Chat-System & Bot-Infrastruktur

Stand: 2026-08-30. Fortlaufendes Protokoll der Arbeit an den LLM-Charakteren (Manager-Bot), der Bot-Infrastruktur und laufenden Untersuchungen. Wird bei größeren Meilensteinen aktualisiert, nicht nach jeder Kleinigkeit.

## Kurzüberblick, wo wir aktuell stehen

- **Live-System-Prompt**: strukturierte Attribut-Notation ("v12" + Ambiente-Filter-Fix), ~1050 Tokens, A/B-getestet bei 97% Trefferquote auf dem Standard-Testset. Läuft produktiv auf dem Manager-Bot.
- **Bekannter, größtenteils behobener Bug**: Getränke wurden nach dem Servieren manchmal erneut ausgelöst, wenn der Nutzer nur dankte/kommentierte (Kontext-Bleed durch die eigenen Zubereitungsschritte im Chatverlauf). Fix deployed (Ambiente-Zeilen-Filter + präzisierte Anweisung), Trefferquote bei realistischen Tests von 2/12 auf 10/12 verbessert.
- **Bekannter, noch offener Bug**: Gelegentliche Namens-/Faktenverwechslung bei direkten Ansprachen (z. B. falscher Name oder falsches Alter in der Antwort) - noch nicht behoben, vermutlich eher ein Fine-Tuning- als ein Prompting-Thema.
- **Fine-Tuning/LoRA-Untersuchung**: WSL2+ROCm lokal versucht, an einem offenen, unbehobenen Microsoft-WSL-Kernel-Bug (`dxgkio_query_adapter_info`) für AMD-RDNA3-Dual-GPU-Systeme gescheitert. WSL wieder deinstalliert. Aktuell in Vorbereitung: natives Dual-Boot-Ubuntu 22.04 auf einer externen USB-SSD (Ventoy-Stick mit ISO ist fertig, Installation steht noch aus).

---

## 1. System-Prompt-Kompression (A/B-Testreihe v0-v21)

### Ausgangslage und Auftrag

Ziel war, den LLM-System-Prompt für die 6 Chat-Charaktere (Manager, Barkeeper, Kellner, Türsteher, Techniker, Werwolf) deutlich zu verkleinern (Tokens sparen = schnellerer Cold-Start auf dem Pi, mehr Kontextfenster übrig), **ohne** die Zuverlässigkeit gegenüber der bisherigen Baseline zu verschlechtern. Sekundäres, nicht hartes Ziel: 98% Trefferquote.

### Methodik

- Lokaler Testharness (`scratchpad/prompt_compress/`, PC-only, nie deployed) gegen das echte lokale Ollama (`qwen2.5:7b-instruct`).
- **Zwei-Phasen-Testing**: Erst alle 100 Haupt-Testfälle mit demselben System-Prompt (nutzt Ollamas Prompt-Präfix-Cache), danach gesammelt alle Bewertungs-("Judge"-)Aufrufe mit einem eigenen, kleineren System-Prompt. Verhindert Cache-Thrashing durch abwechselnde System-Prompts.
- **Explizites Warmup** vor jedem Testlauf (System-Prompt einmal mit leerem User-Text laden), damit der erste echte Testfall nicht den Kaltstart-Preis zahlt.
- `num_ctx` und `num_predict` **immer explizit** gesetzt - ohne das reallokiert Ollama bei jedem Call neu (früher großer Zeitverlust-Bug im Testharness selbst).
- 100 Kern-Testfälle: 35 Getränke-Bestellungen, 15 Erwähnungen ohne Bestellung, 15 "Fakten-Fallen" (falsche Behauptung über einen Charakter, z. B. "Colt, warst du mal Butler?"), 10 echte Eigenfakten, 25 allgemeiner Chat mit/ohne Verlauf.
- Später ergänzt: 25 Getränke-False-Positive-Tests (Negation, Vergangenheit, Hypothetik, dritte Person), 15 Kontext-Served-Tests (Getränk schon im Verlauf erwähnt), 12 produktionsgetreue Kontext-Tests (echte Zubereitungsschritte im Verlauf, wie in echten Discord-Kanälen), 25 Beziehungs-Tests, 20 Multi-Charakter-Ketten-Tests.
- **Judge-Kalibrierung**: Die ursprünglichen Bewertungs-Prompts waren zu streng (plausible Antworten wurden als "falsch" gewertet). Nach Rekalibrierung (Standardwert = bestanden, nur bei eindeutigem Fehler durchfallen) stiegen die gemessenen Werte für ALLE bereits getesteten Varianten um mehrere Prozentpunkte, ohne dass sich am Modell-Output etwas geändert hatte - das war reines Mess-Rauschen der alten, zu strengen Bewertung.

### Versionsverlauf (Auszug, wichtigste Meilensteine)

| Version | Ansatz | Tokens | Trefferquote (rekalibriert) |
|---|---|---|---|
| v0_baseline | Aktuelle Produktions-Prosa (2 Beispiele/Charakter) | 1896 | 93.0% |
| v5 | Strukturierte Notation, 0 Beispiele | 831 | 66.0% (Rückschritt) |
| v6-v9 | Strukturierte Notation + Beispiele (verschieden viele/Formen) | 1084-1223 | 85-94% |
| v10 | + ausführlicherer Schreibstil-Hinweis in `stil()` | 1327-1363 | 90-95% |
| **v11** | 1 gemeinsames Beispiel statt mehrere/pro-Charakter | 1208 | **95.0%** |
| **v12** | wie v11, aber Getränkeliste raus aus dem Prompt, Fuzzy-Match stattdessen | **1012** | **97.0%** ⭐ bestes Ergebnis, live |
| v13-v17 | Diverse Varianten (explizite Klarstellung, "immer JSON"-Zwang, JSON-formatiertes User-Prompt) | 1047-1135 | 85-96% (keine schlug v12) |
| v18-v20 | Versuche, den Getränke-Kontext-Bleed-Bug per Prompt zu fixen | 1054-1073 | 92-94% (Standardtest), aber kein Fix für den eigentlichen Bug |
| v21 | + Hinweis auf den "Schneeball-Effekt" durch Zubereitungsschritte im Verlauf | 1050 | Teilverbesserung, siehe Abschnitt 2 |

**Fazit der Reihe**: v12 (strukturierte Attribut-Notation `person()/stil()/hobbys()/beziehung()`, 1 gemeinsames Beispiel, Getränkeliste raus, Fuzzy-Match) ist die beste gefundene Kombination - schlägt die alte Produktions-Baseline bei 47% weniger Tokens. Ist seit diesem Zeitpunkt live.

### Verworfene Ansätze (mit Begründung)

- **JSON-formatiertes User-Prompt statt Fließtext** (v16/v17): brachte keinen Vorteil, eher Nachteile - das Modell tut sich mit natürlichsprachlichem Chat-Format leichter als mit JSON-als-Eingabe.
- **Getränkeliste als reine Getränkename-Erkennung mit externem Fuzzy-Match statt Liste im Prompt** (v12): hat funktioniert und wurde übernommen - spart ~200 Tokens, 0 Fehlzuordnungen im Test.
- **Kürzeres User-Prompt (~80 statt 160 Token, ohne "Wie antwortet X darauf?"-Frage)**: verschlechtert v12 deutlich stärker (-7pp) als die alte Baseline (-2pp) - production behält das volle 160-Token-Budget.

---

## 2. Gefundene und behobene Bugs

### 2.1 Getränke-Kontext-Bleed (größter gefundener Bug)

**Symptom** (live beobachtet, siehe Screenshot-Vorfall): Nutzer bestellt ein Getränk, Quinn serviert es korrekt. Nutzer bedankt sich nur ("Danke dir, Quinn") - Quinn serviert das gleiche Getränk **erneut**, teils mehrfach hintereinander (Schneeball-Effekt, da jede fälschliche Neu-Bestellung wieder neue Verlaufszeilen mit dem Getränkenamen erzeugt).

**Root Cause**: Eine echte Bestellung erzeugt 4-5 Verlaufszeilen (Bestätigung + Zubereitungsschritte), die alle den Getränkenamen enthalten können. Bei nur 5 sichtbaren Verlaufszeilen (`HISTORY_LENGTH`) kann das den kompletten sichtbaren Verlauf ausfüllen - das Modell erkennt daraufhin fälschlich eine neue Bestellung.

**Getestete reine Prompt-Fixes** (v18-v21): Anweisung "nur aktuelle Nachricht zählt", explizites Beispiel, Schritt-für-Schritt-Prüfanweisung. Bestes Ergebnis 4/12 (33%) bei produktionsgetreuen Tests - nicht ausreichend zuverlässig.

**Tatsächlicher Fix** (Nutzer-Idee: ältere/unwichtige Nachrichten weniger gewichten): Zubereitungsschritte und andere reine Ambiente-Zeilen (durchgängige Konvention im ganzen Bot-Ökosystem: komplett kursiv, `*Text*`) werden jetzt aus dem für das LLM sichtbaren Verlauf gefiltert (`isAmbientLine()` in `chatOrchestrator.js`). Allein dieser Filter hob die Trefferquote von 2/12 auf 9/12; kombiniert mit der präzisierten v21-Anweisung auf **10/12 (83%)**.

**Deployed**: `manager bot/utils/llm/chatOrchestrator.js` - `fetchRecentHistory()` filtert jetzt, `buildOrderInstructions()` hat die präzisierte Anweisung.

### 2.2 Voice-Log-Reihenfolge bei Tisch-Erstellung

**Symptom**: Beim automatischen Erstellen eines neuen Tisches (Beitritt zu "Tisch bestellen") kam das Log in falscher Reihenfolge/mit Dopplung: "Tisch bestellen verlassen" → "Tisch N betreten" (2x), aber "Tisch bestellen betreten" fehlte komplett.

**Root Cause**: `handleVoiceStateUpdate` (Tisch-Erstellung, inkl. programmatischem Channel-Move) lief vor `handleVoiceLog` und wurde awaited - der programmatische Move löst währenddessen ein zweites, echtes Discord-Event aus, das schneller durchläuft. Discord.js' `VoiceState`-Objekte sind zudem live/mutable Referenzen, keine Snapshots - das verzögerte Logging der ersten Nachricht sah dadurch schon den neuen (gemuteten) Stand.

**Fix**: Reihenfolge in `kellner bot/index.js` getauscht - Logging läuft jetzt **vor** der Tisch-Erstellungslogik, liest die Zustände also synchron, bevor irgendein Move ausgelöst werden kann. Noch nicht auf den Pi deployed (Fix steht lokal bereit).

### 2.3 Kleinere Wording-Fixes (deployed)

- Willkommensnachricht: "Willkommen an der Bar" → "Willkommen **in** der Bar" (korrekte Präposition).
- Getränke-Bestätigung: "Auf geht's, {user}!..." (unpassend) → "Wird gemacht, {user}!...".
- Situationskontext im User-Prompt: zeigt jetzt das Jahr **minus 100** (aktuell 1926 statt 2026) fürs 1920er-Bar-Setting, Wochentag/Tag/Monat bleiben real.

### 2.4 Noch offener Bug: Namens-/Faktenverwechslung

**Symptom** (Screenshot-Vorfall): Auf direkte Ansprache antwortete Benedict mit falschem Namen ("...Quinn" statt des tatsächlichen Fragestellers) und falschem Alter (44 statt der im Roster hinterlegten 41).

**Einschätzung**: Vermutlich dieselbe grundlegende Schwäche wie beim Getränke-Bug (falsches, aber naheliegendes Detail statt des korrekten aus einem dichten Kontext greifen) - diesmal aber ohne offensichtlichen code-seitigen Hebel wie den Ambiente-Filter. Noch nicht behoben, Kandidat für ein künftiges Fine-Tuning statt weiterer Prompt-Iteration.

---

## 3. Infrastruktur-Änderungen

### 3.1 Dynamische Nachrichten-Sets (kein Neustart für Text-Änderungen mehr nötig)

Auf Nutzerwunsch alle "Sets an Zufalls-Nachrichten, aus denen zufällig gewählt wird" (Getränke-Bestätigung, Snack-Bestellung, Bot-Bestellanfragen, Tisch-Abwischen, Snack-Lieferung, Kaffeemaschine-Reinigung, `/calm`) aus hartkodierten JS-Arrays in JSON-Dateien ausgelagert:

- Neuer Helper `shared/lib/messageLines.js` - liest die passende JSON-Datei bei **jedem Aufruf frisch** von der Platte (kein Require-Cache), Änderungen greifen also sofort, ohne den jeweiligen Bot neu zu starten.
- `shared/data/messages/{barkeeper,tuersteher,kellner}.json` - je Bot eine Datei mit benannten Schlüsseln (z. B. `orderComing`, `calm`, `tableWipe`).
- Betroffene Dateien umgestellt: `barkeeper bot/utils/drinks/{serving,supply}.js`, `barkeeper bot/commands/snack/snack.js`, `barkeeper bot/utils/botInteractions/orderDrink.js`, `kellner bot/utils/botInteractions/tableWiping.js`, `kellner bot/utils/snackDelivery/scheduler.js`, `türsteher bot/commands/moderation/calm.js`.

### 3.2 Frühere Session-Arbeit (zur Einordnung, nicht Teil dieses Logs im Detail)

- PC/14B-Anbindung komplett entfernt, Manager-Bot nutzt ausschließlich das Pi-lokale `qwen2.5:7b-instruct`.
- `/model`-Befehl bei Techniker auf `list`/`set` reduziert (context/samples/raw/pull/pc entfernt).
- Charakter-Roster fest im Code statt DB-gestützt.
- Lidarr/Jackett/Prowlarr (Navidrome-Altlasten) vom Pi entfernt, RAM dadurch entlastet.
- `llama-server`/Ollama-Ressourcenlimits gesetzt (Soft 5,5GB/Max 6,5GB), `OLLAMA_KEEP_ALIVE=-1`.

---

## 4. LoRA/Fine-Tuning-Untersuchung

### Auslöser

Mehrere gefundene Bugs (Getränke-Kontext-Bleed, Namens-/Faktenverwechslung) sind eher grundlegende Modell-Schwächen ("richtiges Detail aus dichtem/ablenkendem Kontext greifen") als reine Formulierungsprobleme - Prompting stößt hier an eine Grenze. Fine-Tuning (LoRA/QLoRA) wurde als möglicher nächster Schritt diskutiert.

### WSL2 + ROCm (versucht, gescheitert)

- WSL2 + Ubuntu 22.04 installiert, ROCm 7.2 + `librocdxg` (die neue WSL-Compute-Bridge von AMD) installiert.
- GPU (AMD Radeon RX 7900 XT, gfx1100) wurde von `rocminfo`/`amd-smi` korrekt erkannt.
- PyTorch (ROCm-Build) erkannte trotzdem **keine** GPU (`torch.cuda.is_available() = False`, `device_count = 0`).
- Root Cause gefunden: Kernel-Log zeigte `dxgkio_query_adapter_info: Ioctl failed: -22` - ein **offener, unbehobener Bug im Microsoft-WSL-Kernel-Treiber** (`dxgkrnl`), der bei AMD-RDNA3-Systemen mit zwei GPUs (integriert + dediziert, wie hier) auftritt. Mehrere identische, bis dato unbeantwortete Issues im `microsoft/WSL`-GitHub-Repo gefunden (u. a. praktisch identischer Fall mit einer RX 7800 XT).
- Kein bekannter Workaround - WSL2 + Ubuntu wieder vollständig deinstalliert (System ist wieder im Ausgangszustand).

### Recherche zu nativem Windows-Training

- AMDs offizielles natives Windows-PyTorch (ROCm-basiert, Public Preview, unterstützt RX 7000/9000-Serie inkl. sehr ähnlicher RX 7900 XTX) ist ausdrücklich **nur für Inferenz**, keine Trainings-/Backward-Pass-Unterstützung dokumentiert.
- Ein dokumentierter Community-Versuch, Qwen2.5-**7B** per QLoRA auf nativem Windows zu trainieren, ist **gescheitert** (bitsandbytes/4-Bit-Quantisierung auf Windows nicht zuverlässig genug) - musste auf Qwen2.5-3B mit einfachem LoRA (ohne Quantisierung) ausweichen, um überhaupt einen funktionierenden Lauf zu bekommen. Vermutlich sogar NVIDIA-basiert, also nicht mal AMD-spezifisch - generelles "natives Windows-Training ist fragil"-Problem.
- Selbst auf **nativem Linux** berichten Community-Quellen von rocBLAS-Kernel-Abstürzen bei normalem LoRA auf neueren AMD-Karten (andere Generation als unsere, RDNA4) - dort ist QLoRA die einzige funktionierende Variante.

### Aktueller Stand: Dual-Boot-Vorbereitung

- Entscheidung: natives Ubuntu 22.04 LTS auf einer **externen USB-SSD** (256GB), NICHT auf der internen Windows-Systemplatte - kein Partitionierungsrisiko, volle Persistenz (kein reiner "Live"-Modus), volle Bare-Metal-GPU-Erkennung (umgeht den WSL-`dxgkrnl`-Bug komplett, da kein Virtualisierungslayer).
- Ventoy-Stick vorbereitet: `ubuntu-22.04.5-desktop-amd64.iso` heruntergeladen, SHA256-Prüfsumme verifiziert (`bfd1cee0...` ✓), liegt auf dem Stick bereit.
- **Nächster Schritt** (noch nicht erledigt): Vom Ventoy-Stick booten, Ubuntu auf der externen SSD installieren (Zielplatte im Installer bewusst auf die externe SSD setzen, nicht die interne), danach ROCm + PyTorch nativ installieren und den 3B-vs-7B- bzw. LoRA-Trainingsversuch neu aufsetzen.

### Nebenbefund: 3B vs. 7B lokal verglichen (ohne Fine-Tuning)

Mit v12 auf `qwen2.5:3b-instruct` statt `7b-instruct` getestet: Gesamtquote bricht auf 64% ein (v.a. Fakten-Fallen: 1/15!), aber überraschend **besser** bei den Getränke-Kontext-Bleed-Tests (13/15 vs. 7/15 beim 7B) und perfekt bei reinen False-Positives (25/25). Deutet darauf hin, dass das kleinere Modell weniger zu assoziativem "Wort im Kontext gesehen → Feld setzen"-Verhalten neigt, dafür aber zu schwach für verlässliche Charaktertreue ist. Für Produktion bleibt 7B klar überlegen.

---

## 5. Besprochen, aber nicht umgesetzt

- **Spenden-/Belohnungssystem**: Konzept besprochen (Ko-fi als Plattform-Empfehlung wegen echter Einmalspenden + Webhook + optionaler nativer Discord-Rollen-Integration bei Memberships, Spender-Code zur anonymen Zuordnung, ein aktives Spendenziel gleichzeitig). Belohnungsarten (XP/Badge/Rolle) noch nicht final entschieden. Nicht implementiert.
- **Server-Wachstum**: Beratung zu Sichtbarkeit (weitere Listing-Plattformen, Bump-Timing), Content-Marketing rund um das LLM-Chat-System, Onboarding-Erlebnis, Invite-Belohnungen. Keine konkrete Umsetzung angestoßen.

---

## Test-Infrastruktur (Referenz)

Der komplette lokale A/B-Testharness liegt im Scratchpad (PC-only, nie deployed, nicht Teil des Git-Repos):
`scratchpad/prompt_compress/` - `testcases.js` (alle Testfall-Sets), `variants.js`/`roster.js` (Prompt-Bausteine je Version), `configs.js` (alle v0-v21-Konfigurationen), `runner.js` (Zwei-Phasen-Testrunner + Judges), diverse `*_test.js`-Treiberskripte pro Untersuchung, `system_prompts/*.txt` (finale Prompt-Texte jeder Version als Referenz).
