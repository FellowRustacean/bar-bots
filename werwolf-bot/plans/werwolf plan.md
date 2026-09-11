There is one narrator/group leader. They use /werwolf create to create a lobby and then become the session leader of that voice channel. A lobby can consist of 5 to 15 players. 

Werwolf can only be played in a voice channel. Other people who are in the voice channel can join using /werwolf join and leave using /werwolf leave

The creator can then run /werwolf start to start the round. When a player leaves the voice channel, they're considered dead.

/werwolf cancel will cancel the current game. This needs to be confirmed with a modal where the creator has to enter "cancel" again. Only the creator can cancel a game

/werwolf role <role> shows a role description that just pulls the info from a werwolf_roles.json

/werwolf status - can be used by any. Shows current game state with how many people and roles are still alive

add a `/config setcategory <werwolf> <#category>` that'll determine where there chat for the werewolfs is created.

# Spielablauf
## Rollen
### Das Dorf (gut, inkl. möglicher Sub-Teams über Amor)
- Dorfbewohner (immer 3 Spieler) - keine besonderen Fähigkeiten
- Doktor (max 1) - Kann jede Nacht einen Spieler auswählen, der in der Nacht nicht getötet werden kann
- Jäger (max 2) - Wählt in der ersten Nacht einen anderen Spieler. Stirbt der Jäger, stirbt der andere Spieler
- Priester (max 1) - Kann einmal heiliges Wasser auf einen anderen Spieler werfen. Ist der andere Spieler ein Werwolf, stirbt der Werwolf. Wenn nicht, dann stirbt der Priester
- Seher (max 1) - Kann jede Nacht von einem beliebigen Spieler die Rolle ansehen
- Hexe (max 1) - Hat zwei Tränke. Ein Trank tötet einen beliebigen Spieler, der andere Trank kann einen Spieler vor dem Tod bewahren
- Amor (max 1) - Verliebt in der ersten Nacht 2 Spieler. Stirbt einer der Spieler, sterben beide.
- Schütze (max 1) - Kann zwei Mal im Spiel einen beliebigen Spieler töten. Nach dem ersten Töten wird die Rolle offengelegt
- Aura-Seher (max 1) - Kann jede Nacht sehen ob ein Spieler gut oder Böse ist
### Werwölfe (böse)
- Werwolf (min 1 max 3) - Einigen sich nachts darauf, einen beliebigen Spieler zu töten
- Werwolf Schamane (min. 10 Spieler, max 1) - Kann in der Nacht einen Spieler festlegen der von Sehern in der Nacht als Werwolf gesehen wird
### Solo- & Sub-Teams (böse)
- Narr (min 8 Spieler, max 1)- Keine Fähigkeit. Wird er vom Dorf getötet, gewinnt er das Spiel
- Kopfgeldjäger (min 10 Spieler, max 1) - Erhält zu Beginn des Spiels ein Ziel. Überzeugt er das Dorf das Ziel zu töten, gewinnt er das Spiel
- Brandstifter (min 12 Spieler, max 1) - Kann jede Nacht 2 Spieler mit Benzin überschütten oder alle bisher überschütteten anzünden und damit töten. Gewinnt, wenn er der letzte lebende Spieler ist. Kann nicht von Werwölfen getötet werden
### Rollenverteilung
Spieler	Dorf	Werwölfe	Solo-/Sub-Teams
5	4	1	0
6	5	1	0
7	5	2	0
8	5	2	1
9	6	2	1
10	7	2	1
11	7	3	1
12	8	3	1
13	8	3	2
14	9	3	2
15	9	4	2
## Vorbereitung
Mit 5-15 Spielern kann der Ersteller `/werwolf start` ausführen. Der Bot ist der Erzähler und regelt den Ablauf des Spiels. Alle Spieler bekommen zufällig eine Rolle zugeteilt. Spieler sehen ihre Rolle per `/werwolf me`. Dieser Befehl wird zu Beginn des Spiels in einer Nachricht erwähnt. Die Rollenverteilung und Auswahl aus den Sets/Gruppen ist zufällig
## Spielziel
Für jedes Team ist es das Ziel, alle anderen Teams komplett zu töten oder ihr Solo-Ziel zu erreichen. 
Das durch Amor verliebte Paar gewinnt, wenn sie zusammen oder sie mit Amor die letzten 2 bzw. 3 lebenden sind. Amor gewinnt auch, wenn das Liebespaar gewinnt
# Spielablauf
## Erste Nacht
- Amor wählt 2 Spieler, die sich verlieben und gegenseitig sehen.
- Jäger wählt einen anderen Spieler als sein verbundenes Ziel.
- Kopfgeldjäger erhält sein zufälliges Ziel.
- Werwölfe sehen sich und wählen ein Opfer.
- Optional: Werwolf-Schamane bestimmt einen Spieler für die Seher.
- Doktor wählt einen Spieler zum Schutz.
- Seher sieht die Rolle eines Spielers.
- Aura-Seher sieht Gut/Böse eines Spielers.
- Optional: Hexe verwendet Heil- und/oder Gifttrank.
- Optional: Priester verwendet sein heiliges Wasser.
- Optional: Schütze verwendet einen Schuss.
- Optional: Brandstifter markiert Spieler oder entzündet alle markierten Spieler.
- Nacht wird aufgelöst und Todesketten werden ausgeführt.
## Tag
- Die Sonne geht auf und der Bot verkündet die Ereignisse der Nacht.
- Tote Spieler werden bekannt gegeben und scheiden aus dem Spiel aus.
- Optional: Rollen der Verstorbenen werden aufgedeckt.
- Die lebenden Spieler diskutieren und versuchen, Werwölfe bzw. böse Spieler zu identifizieren.
- Optional: Der Kopfgeldjäger versucht, sein Ziel von der Gruppe töten zu lassen.
- Das Dorf stimmt über einen Spieler ab, der getötet werden soll.
- Der Spieler mit den meisten Stimmen stirbt.
- Optional: Bei Gleichstand gibt es eine Stichwahl oder niemand stirbt.
- Optional: Wird der Narr vom Dorf getötet, gewinnt der Narr sofort.
- Todesketten durch Verliebte und Jäger werden ausgeführt.
- Siegbedingung wird geprüft.
- Wenn niemand gewonnen hat, beginnt die nächste Nacht.
## Alle weiteren Nächte
- Werwölfe wählen ein Opfer.
- Optional: Werwolf-Schamane bestimmt einen Spieler für die Seher.
- Doktor wählt einen Spieler zum Schutz.
- Seher sieht die Rolle eines Spielers.
- Aura-Seher sieht Gut/Böse eines Spielers.
- Optional: Hexe verwendet Heil- und/oder Gifttrank, sofern noch vorhanden.
- Optional: Priester verwendet sein heiliges Wasser, sofern noch vorhanden.
- Optional: Schütze verwendet einen seiner verbleibenden Schüsse.
- Optional: Brandstifter markiert Spieler oder entzündet alle markierten Spieler.
- Nacht wird aufgelöst und Todesketten werden ausgeführt.
- Siegbedingung wird geprüft.
### Spieler-/Bot-Interaktionen
- Der Bot schickt immer Nachrichten in den Voice Channel Chat. Es gibt eine Haupt-Nachricht, wo alle Rollen aufgelistet sind. Wurden Rollen für alle aufgedeckt, bspw. durch Tod oder beim Schützen, wird der User neben der entsprechenden Rolle markiert.
- Der Bot kündigt sowas an wie "Amor erwacht und wählt 2 Spieler aus, die sich verlieben", jeweils immer mit kurzer Anleitung was gemacht werden muss
    -> Amor muss `/werwolf ziel <@User>` 2x nutzen auf verschiedene User
    -> Spieler haben jeweils 60 Sekunden Zeit, ihre Aktion auszuführen
    -> Spieler können `/werwolf skip` nutzen, um eine Aktion zu überspringen
- Während der Nacht werden alle im Voice Channel stummgeschaltet
- Tote Spieler werden bis Spielende stummgeschaltet
- Verlässt ein User den Voice Channel, gilt er direkt als tot und wird die Siegbedingung erneut geprüft
### Beispielablauf 5 Spieler
Spiel startet, neuer Chat in "Werwolf" Kategorie wird erstellt, "#werwolf-tisch-<n>". Alle Werwölfe bekommen Zugriff, werden nach Tod entfernt
#### Haupt-Nachricht
Das Dorf:
Dorfbewohner - ??? (User 1)
Dorfbewohner - ??? (User 2)
Dorfbewohner - ??? (User 3)
Jäger - ??? (User 4)
Werwölfe:
Werwolf - ??? (User 5)
#### Spielverlauf-Nachricht, wird fortlaufend geupdated
"Das Dorf schläft ein..."
[2 Sekunden Timer]
[Alle Spieler werden stummgeschaltet]
"Der Jäger erwacht. Nutze `/werwolf ziel <@User>` um eine Person auszuwählen, die stirbt wenn du stirbst <TIMER>"
[60 Sekunden Timer startet]
Jäger/User 4: führt `/werwolf ziel <@User>` aus
[Timer wird beendet]
"Der Jäger schläft wieder ein..."
[2 Sekunden Timer]
"Die Werwölfe erwachen. Nutzt <#werwolf-tisch-<n>> um euch abzusprechen. Stimmt per `/werwolf ziel <@User 3>` für ein Opfer. Bei einem Unentschieden wird eins der Ziele per Zufall ausgewählt <TIMER>"
Zusätzlich: #werwolf-tisch-<n>: <TIMER>
[90 Sekunden Timer]
Werwölfe / User 5: Geben alle `/werwolf ziel <@User 2>` ein
[Timer wird beendet]
"Die Werwölfe schlafen wieder ein..."
[2 Sekunden Timer]
"Das Dorf erwacht..."
[2 Sekunden Timer]
"... doch <@User 2> liegt zerfleischt auf dem Dorfsplatz.
[<@User 2> wird stummgeschaltet]
"Das Dorf kann jetzt diskutieren, wer gelyncht werden soll. Abstimmen könnt ihr per `/werwolf ziel <@User>`. Bei einem Unentschieden stirbt keiner."
[120 Sekunden Timer]
Alle User: `/werwolf ziel <@User>`

und so weiter