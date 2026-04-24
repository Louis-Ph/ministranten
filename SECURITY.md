# Sicherheitsrichtlinie

Die Sicherheit der Ministranten, ihrer Daten und aller Nutzerinnen und Nutzer
dieser App hat höchste Priorität. Vielen Dank, dass du dir die Zeit nimmst,
einen Sicherheitsbefund zu melden.

## Unterstützte Versionen

Aktualisierungen und Sicherheits-Patches werden ausschließlich für die
jeweils letzte stabile Version veröffentlicht.

| Version | Unterstützt        |
|---------|--------------------|
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Sicherheitslücken melden

- **Bitte öffne _kein_ öffentliches Issue**, wenn du eine Schwachstelle
  entdeckt hast.
- Sende stattdessen eine E-Mail an **`security@minis-wettstetten.de`**
  mit einer möglichst genauen Beschreibung, Reproduktionsschritten und
  gegebenenfalls einem Proof-of-Concept.
- Alternativ kann der GitHub-Mechanismus
  **„Privat Sicherheits­lücke melden“** (Tab „Security“ im Repository)
  genutzt werden.

Wir antworten in der Regel innerhalb von **72 Stunden** und bemühen uns,
bestätigte Schwachstellen innerhalb von **14 Tagen** zu beheben.

## Umfang

Relevante Meldungen betreffen unter anderem:

- Cross-Site-Scripting (XSS), CSRF, Clickjacking
- Authentifizierungs- und Autorisierungsschwächen
- Umgehung der Firebase-Regeln
- Preisgabe personenbezogener Daten entgegen der DSGVO
- Schwachstellen in eingebundenen CDN-Ressourcen

Nicht im Umfang:

- Social-Engineering-Angriffe gegen Personen des Teams
- DoS-/DDoS-Tests gegen Produktivumgebungen
- Selbst gehostete Forks, bei denen Firebase-Keys eigenständig vergeben
  wurden

## Umgang mit Meldungen

1. Wir bestätigen den Eingang der Meldung.
2. Wir bewerten den Befund und klassifizieren nach Schweregrad
   (CVSS-orientiert).
3. Wir entwickeln und testen einen Fix.
4. Ein Patch-Release wird veröffentlicht. Die Meldenden werden, sofern
   gewünscht, im Changelog namentlich bedankt.

## Verschlüsselter Kontakt

Für sensible Meldungen kann auf Anfrage ein PGP-Schlüssel bereitgestellt
werden.
