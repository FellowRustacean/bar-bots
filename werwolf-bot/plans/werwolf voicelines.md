# Werwolf Voicelines

Speicherort: `werwolf/voicelines/<dateiname>.mp3` (relativ zum Projekt-Root, flache Struktur,
keine Unterordner - genau wie im Beispiel `dorf_schlaeft_ein.mp3`).

Wichtig: Voicelines können keine dynamischen Namen enthalten (kein TTS) - alle Texte sind
deshalb bewusst generisch gehalten. Konkrete Namen/Ziele stehen weiterhin nur im Text-Chat.

Format je Zeile: `dateiname.mp3` - "Text zum Einsprechen" - *(Trigger)*

## 1. Vorbereitung
- `intro_willkommen.mp3` - "Willkommen bei Werwolf! Schaut euch in Ruhe eure Rolle an." - *(Spielstart)*
- `intro_start_bald.mp3` - "Das Spiel beginnt gleich." - *(kurz vor Ende der Vorbereitungszeit)*

## 2. Tag/Nacht-Übergänge
- `nacht_beginnt.mp3` - "Es wird Nacht. Das Dorf schläft ein." - *(Nachtbeginn)*
- `tag_beginnt.mp3` - "Die Sonne geht auf." - *(Nachtauflösung/Tagbeginn)*

## 3. Rollen: erwacht / muss sich entscheiden / schläft ein
Je Rolle 3 Dateien - "erwacht" beim Öffnen des Aktionsfensters, "eile" wenn der Timer fast
abläuft, "schläft ein" beim Schließen.

| Rolle | erwacht | eile | schläft ein |
|---|---|---|---|
| Amor | `amor_erwacht.mp3` - "Amor erwacht und wählt zwei Spieler, die sich verlieben." | `amor_eile.mp3` - "Amor muss sich entscheiden." | `amor_schlaeft_ein.mp3` - "Amor schläft wieder ein." |
| Jäger | `jaeger_erwacht.mp3` - "Der Jäger erwacht und wählt sein Ziel." | `jaeger_eile.mp3` - "Der Jäger muss sich entscheiden." | `jaeger_schlaeft_ein.mp3` - "Der Jäger schläft wieder ein." |
| Werwölfe | `werwoelfe_erwachen.mp3` - "Die Werwölfe erwachen und wählen ihr Opfer." | `werwoelfe_eile.mp3` - "Die Werwölfe müssen sich entscheiden." | `werwoelfe_schlafen_ein.mp3` - "Die Werwölfe schlafen wieder ein." |
| Werwolf-Schamane | `schamane_erwacht.mp3` - "Der Werwolf-Schamane erwacht." | `schamane_eile.mp3` - "Der Schamane muss sich entscheiden." | `schamane_schlaeft_ein.mp3` - "Der Schamane schläft wieder ein." |
| Doktor | `doktor_erwacht.mp3` - "Der Doktor erwacht und wählt einen Spieler zum Schutz." | `doktor_eile.mp3` - "Der Doktor muss sich entscheiden." | `doktor_schlaeft_ein.mp3` - "Der Doktor schläft wieder ein." |
| Seher | `seher_erwacht.mp3` - "Der Seher erwacht und darf eine Rolle ansehen." | `seher_eile.mp3` - "Der Seher muss sich entscheiden." | `seher_schlaeft_ein.mp3` - "Der Seher schläft wieder ein." |
| Aura-Seher | `auraseher_erwacht.mp3` - "Der Aura-Seher erwacht." | `auraseher_eile.mp3` - "Der Aura-Seher muss sich entscheiden." | `auraseher_schlaeft_ein.mp3` - "Der Aura-Seher schläft wieder ein." |
| Hexe | `hexe_erwacht.mp3` - "Die Hexe erwacht." | `hexe_eile.mp3` - "Die Hexe muss sich entscheiden." | `hexe_schlaeft_ein.mp3` - "Die Hexe schläft wieder ein." |
| Priester | `priester_erwacht.mp3` - "Der Priester erwacht." | `priester_eile.mp3` - "Der Priester muss sich entscheiden." | `priester_schlaeft_ein.mp3` - "Der Priester schläft wieder ein." |
| Schütze | `schuetze_erwacht.mp3` - "Der Schütze erwacht." | `schuetze_eile.mp3` - "Der Schütze muss sich entscheiden." | `schuetze_schlaeft_ein.mp3` - "Der Schütze schläft wieder ein." |
| Brandstifter | `brandstifter_erwacht.mp3` - "Der Brandstifter erwacht." | `brandstifter_eile.mp3` - "Der Brandstifter muss sich entscheiden." | `brandstifter_schlaeft_ein.mp3` - "Der Brandstifter schläft wieder ein." |

Hinweis Hexe: Die Hexe wacht im Spiel zweimal auf (Heiltrank, dann Gifttrank). `hexe_erwacht.mp3`
und `hexe_eile.mp3` werden für beide Male wiederverwendet - keine separaten Dateien nötig.

## 4. Tod / Nachtauflösung
- `niemand_gestorben.mp3` - "Niemand ist in dieser Nacht gestorben." - *(keine Todesopfer)*
- `jemand_gestorben.mp3` - "Doch nicht alle haben die Nacht überlebt..." - *(mindestens ein Todesopfer, Details stehen im Chat)*
- `spieler_verlaesst.mp3` - "Ein Spieler hat den Voice-Channel verlassen und gilt als tot." - *(Voice-Leave-Tod)*

## 5. Tagesabstimmung
- `abstimmung_beginnt.mp3` - "Das Dorf darf nun abstimmen, wer gelyncht werden soll." - *(Beginn der Abstimmung)*
- `abstimmung_eile.mp3` - "Das Dorf muss sich entscheiden." - *(Timer läuft bald ab)*
- `niemand_gelyncht.mp3` - "Niemand wurde gelyncht." - *(keine Stimmen abgegeben)*
- `unentschieden.mp3` - "Es gab ein Unentschieden. Niemand stirbt." - *(Stimmengleichstand)*
- `gelyncht.mp3` - "Das Dorf hat entschieden. Ein Spieler wird gelyncht." - *(Lynch-Ergebnis, vor der Namensnennung im Chat)*

## 6. Spielende
- `sieg_dorf.mp3` - "Das Böse ist besiegt und das Dorf gewinnt"
- `sieg_werwoelfe.mp3` - "Die Werwölfe haben das Dorf überwältigt. Die Werwölfe gewinnen!"
- `sieg_liebespaar.mp3` - "Das Liebespaar hat überlebt und gewinnt gemeinsam!"
- `sieg_narr.mp3` - "Der Narr wurde gelyncht und gewinnt!"
- `sieg_kopfgeldjaeger.mp3` - "Der Kopfgeldjäger hat sein Ziel eliminiert und gewinnt!"
- `sieg_brandstifter.mp3` - "Der Brandstifter ist der letzte Überlebende und gewinnt!"
- `spiel_abgebrochen.mp3` - "Das Spiel wurde abgebrochen."

## 7. Pause / Fortsetzen
- `pause.mp3` - "Das Spiel wurde pausiert."
- `fortsetzen.mp3` - "Das Spiel wird fortgesetzt."

---

**Insgesamt: ~50 Dateien.** Die "eile"-Zeilen (Kategorie 3 + `abstimmung_eile.mp3`) sind neu -
im aktuellen Code gibt es noch keine "Zeit läuft bald ab"-Erinnerung. Sobald die Dateien
vorliegen, kann ich sowohl die Wiedergabe (Bot joint den Voice-Channel und spielt die passende
Datei an jedem der obigen Trigger-Punkte) als auch die neue "eile"-Erinnerung (z. B. bei den
letzten 15 Sekunden im Auto-Modus) einbauen.
