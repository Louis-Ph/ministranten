# Minis Wettstetten

> Dienstplan, Chat und Verwaltung für die Ministrantinnen und Ministranten der
> Pfarrei Wettstetten. Eine installierbare Progressive Web App in einer einzigen
> Datei – gebaut mit Vanilla JavaScript und Firebase Compat v9.

<p align="left">
  <a href="./LICENSE"><img alt="Lizenz: MIT" src="https://img.shields.io/badge/Lizenz-MIT-0066cc?style=flat-square"></a>
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installierbar-0066cc?style=flat-square">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/Vanilla%20JS-ES2020%2B-1d3557?style=flat-square">
  <img alt="Firebase" src="https://img.shields.io/badge/Firebase-9.0.0%20compat-e63946?style=flat-square">
  <img alt="WCAG 2.2 AA" src="https://img.shields.io/badge/WCAG%202.2-AA-00cc88?style=flat-square">
  <img alt="Single File" src="https://img.shields.io/badge/Architektur-Single%20File-1d3557?style=flat-square">
</p>

---

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Funktionen](#funktionen)
3. [Architektur](#architektur)
4. [Voraussetzungen](#voraussetzungen)
5. [Schnellstart](#schnellstart)
6. [Entwicklung & lokale Ausführung](#entwicklung--lokale-ausführung)
7. [Tests](#tests)
8. [Deployment](#deployment)
9. [Sicherheit](#sicherheit)
10. [Barrierefreiheit](#barrierefreiheit)
11. [Druckansicht](#druckansicht)
12. [Datenmodell](#datenmodell)
13. [Mitwirken](#mitwirken)
14. [Lizenz](#lizenz)

---

## Überblick

**Minis Wettstetten** ist eine clientseitige Progressive Web App, die den
kompletten Ablauf eines Ministranten-Teams abbildet: Gottesdienstplanung mit
Fristen und Ersatzsuche, Gruppenchat mit automatischen Systemnachrichten,
Punktesystem, Benutzerverwaltung und Datenbank-Backup.

Die gesamte Anwendung besteht aus einer einzigen `index.html`. Sie benötigt
keinen Build-Schritt, keine Abhängigkeiten im Produktivbetrieb und kann direkt
über GitHub Pages gehostet werden. Das Backend (Auth, Realtime Database,
Cloud Messaging) wird von Firebase bereitgestellt.

## Funktionen

- **Rollenmodell** – Ministrant (User), Obermini (Admin), Entwickler (Dev) mit
  abgestuften Rechten und ARIA-konformer Rollenkennzeichnung.
- **Dienstplaner** – Termine mit Titel, Beschreibung, Mindest-Teilnehmerzahl,
  Farbakzent und Abmeldefrist in Tagen.
- **Serien-Anlage „3 Monate“** – Eine Checkbox legt 12 aufeinanderfolgende
  Wochen-Termine atomar via `Promise.all` an.
- **Ein- und Austragen** – Namens-Pills direkt auf der Karte, Mindest-Quote
  sichtbar, eigene Teilnahme farblich hervorgehoben.
- **Ersatzsuche** – Austragen nach Ablauf der Frist löst einen Warndialog, eine
  rote Systemnachricht im Chat, einen Badge „ERSATZ GESUCHT“ und eine rot
  pulsierende Karte aus; die Statistik `lateCancelled` wird erhöht.
- **Statistik & Leaderboard** – Zähler `attended` / `cancelled` /
  `lateCancelled`, sortierbar, druckfähig.
- **Globaler Chat** – `limitToLast(40)`, Systemnachrichten visuell abgehoben,
  Auto-Hinweis-Toast bei Systemmeldungen jünger als zwei Stunden.
- **Push-Benachrichtigungen** – Firebase Cloud Messaging mit Token-Speicherung
  pro Benutzer.
- **Passwort-Zwang** – Unschließbares Vollbild-Modal bei
  `mustChangePassword: true`; freiwilliger Wechsel jederzeit im Profil.
- **DB-Backup** – Export des kompletten RTDB-Roots als JSON; Import mit
  Bestätigungs-Modal (nur für Dev).
- **PWA** – Installierbar, offlinefähig, Service Worker als Blob-URL im selben
  Dokument registriert.
- **Backends umschaltbar** – Firebase (Cloud), **SQLite lokal** (sql.js WASM,
  IndexedDB-Persistenz) oder Mock im Arbeitsspeicher; die Auswahl erfolgt im
  Dev-Bereich und wird im Browser gespeichert.
- **Intergenerationelles UI** – Glassmorphismus-Pro-Tool-Look statt
  kindlicher Ästhetik, responsiv vom Smartphone bis zum Desktop.

## Architektur

### Einzige Datei, klare Trennung

```
index.html
├── <head>        Meta, CSP, Inter, FontAwesome
├── <style>       Design-Tokens, Komponenten, @media print, reduced-motion
├── <body>        Skip-Link, App-Root, Modal-Root, Toast-Container
└── <script>      Firebase-Init → Service-Worker-Blob
                  → XSS-sicherer DOM-Builder & Toast-Manager
                  → Finite State Machine (Proxy + PubSub)
                  → Business-Logik (Auth, Planner, Stats, Chat, FCM, Backup)
                  → Render-Funktionen pro View
                  → Boot
```

### Leitprinzipien

- **Finite State Machine** – Die Oberfläche befindet sich jederzeit in genau
  einer der definierten Views (`LOGIN`, `HOME`, `CHAT`, `PROFILE`, `STATS`,
  `ADMIN`, `DEV`). Übergänge laufen ausschließlich über den globalen `state`
  (reactiver `Proxy`).
- **Semantische Silos** – Jede View/Komponente (Dienst-Karte, Modal, Chat)
  ist eine eigene Funktion mit eigenen Event-Listenern, keine verstreuten
  DOM-Referenzen.
- **XSS strukturell unmöglich** – Nutzerdaten werden ausschließlich über
  `textContent` bzw. `document.createTextNode()` eingefügt. Der
  DOM-Builder `h()` bietet erst gar keine Möglichkeit, dynamische Strings
  als HTML zu interpretieren.
- **Service Worker im selben Dokument** – Der SW-Code wird als String in ein
  `Blob` gepackt, per `URL.createObjectURL` registriert und verfolgt eine
  `Network-first`-Strategie (Realtime-Daten haben Vorrang).

## Backends

Die App abstrahiert den Datenzugriff hinter einer einheitlichen Schnittstelle
(`ref()`, `on()`, `once()`, `push()`, `limitToLast()`, `transaction()`) und
bietet drei Implementierungen:

| Backend   | Einsatzgebiet                             | Persistenz               | Auth                        |
|-----------|-------------------------------------------|--------------------------|-----------------------------|
| Firebase  | Produktivbetrieb                          | Realtime Database Cloud  | Firebase Auth (Email/PW)    |
| **SQLite** | **Übergangslösung / Offline-Testbetrieb** | **IndexedDB (WASM-DB)** | Lokal (PBKDF2-SHA256)       |
| Mock      | Unit- und E2E-Tests                       | Arbeitsspeicher          | Automatisches Einloggen     |

### Backend umschalten

- **Administrativ**: Dev-Zugang → Tab „Dev“ → Karte „Backend / Verbindung“ →
  Option wählen → „Backend übernehmen (Neuladen)“. Die Auswahl bleibt
  pro Browser im `localStorage` erhalten (`minis.backend`).
- **URL-Override** (für Tests): `?backend=sqlite`, `?backend=mock`,
  `?backend=firebase` oder die Abkürzung `?mock=1`.

### SQLite-Details

- Lädt `sql-wasm.js` und `sql-wasm.wasm` von cdnjs (v1.10.3).
- Schema mit echten relationalen Tabellen (`users`, `services`,
  `serviceAttendees`, `chat`, `stats`) inkl. Indizes und `ON CONFLICT`-Upserts.
- Persistenz: die vollständige SQLite-Binärdatei wird debounced
  (400 ms) in IndexedDB (`minis-sqlite` Store) gespeichert.
- Passwörter: PBKDF2 (120 000 Iterationen, SHA-256) mit pro Account zufällig
  generiertem 16-Byte-Salt.
- Seed-Account beim ersten Start: Benutzer `admin`, Passwort `admin1234`,
  Rolle Admin, mit aktivem Pflicht-Passwortwechsel.

## Voraussetzungen

| Zweck                   | Werkzeug / Version           |
|-------------------------|------------------------------|
| Produktivbetrieb        | Moderner Browser (Chrome ≥ 100, Safari ≥ 16, Firefox ≥ 110, Edge) |
| Hosting                 | GitHub Pages *oder* beliebiger statischer Webserver |
| Backend                 | Firebase-Projekt mit aktivierter **Realtime Database (europe-west1)**, **Email/Password-Auth** und **Cloud Messaging** |
| Lokales Entwickeln      | Node.js ≥ 20, npm ≥ 10 |
| Tests                   | Vitest (happy-dom) & Playwright (Chromium) |

## Schnellstart

```bash
git clone <repository-url> minis-wettstetten
cd minis-wettstetten
npm install
npm run dev             # http://localhost:8080
```

Für das vollständige Verhalten ohne Netzwerk:

```bash
# startet die App im Mock-Modus (In-Memory-Firebase)
open "http://localhost:8080/index.html?mock=1"
```

### Firebase konfigurieren

1. Firebase-Projekt anlegen und das Snippet in
   [`index.html`](./index.html) (Abschnitt `firebaseConfig`) ersetzen.
2. **Realtime Database** → Region `europe-west1` auswählen.
3. Regeln aus [`firebase.rules.json`](./firebase.rules.json) einspielen:
   ```bash
   firebase deploy --only database
   ```
4. **Authentication** → Anbieter `Email/Password` aktivieren.
5. Optional: **Cloud Messaging** → Web-Push-Zertifikat (VAPID) anlegen.

## Entwicklung & lokale Ausführung

| Kommando                | Beschreibung                                           |
|-------------------------|--------------------------------------------------------|
| `npm run dev`           | Statischer HTTP-Server auf Port 8080                   |
| `npm run test:unit`     | Unit-Tests (Vitest + happy-dom)                        |
| `npm run test:unit:watch` | Unit-Tests im Watch-Modus                            |
| `npm run test:e2e`      | End-to-End-Tests (Playwright, Desktop + Mobile)        |
| `npm run test:e2e:ui`   | Playwright mit interaktivem UI-Runner                  |
| `npm run test`          | Beide Testsuiten hintereinander                        |

## Tests

| Schicht        | Werkzeug     | Anzahl | Schwerpunkt |
|----------------|--------------|--------|-------------|
| Unit           | Vitest + happy-dom | 30     | Datums- und Businesslogik, DOM-Builder, FSM-Übergänge, XSS-Sicherheit |
| End-to-End     | Playwright   | 10 × 2 Projekte | Login, Dev-Masterkey, Navigation, Serie 12 Termine, Escape schließt Modal, Chat-XSS, Druckansicht (A4-PDF) |

Die App exponiert für Tests reine Hilfsfunktionen unter
`window.__MinisTest`. Der `?mock=1`-Query-Parameter ersetzt Firebase durch ein
In-Memory-Backend; damit laufen sämtliche E2E-Tests ohne Internetverbindung.

## Deployment

### GitHub Pages

1. Repository auf GitHub erstellen und den Inhalt pushen.
2. In den Repository-Einstellungen unter **Pages** den Branch `main` auswählen
   (Verzeichnis `/`).
3. Der bereitgestellte Workflow
   [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) veröffentlicht
   die Seite automatisch bei jedem Push auf `main`.

### Firebase-Regeln

```bash
firebase deploy --only database
```

## Sicherheit

- **Keine `innerHTML`-Nutzung für dynamische Inhalte** – strukturelle
  XSS-Immunität.
- **Content-Security-Policy** als `<meta>`-Header – Skripte und Verbindungen
  auf `gstatic.com`, `cdnjs.cloudflare.com` und Firebase-Hosts beschränkt.
- **Subresource Integrity (SRI)** auf extern geladenes CSS.
- **Eingabe-Validierung** bei Benutzername, Passwort-Länge,
  Dienst-Titel/Beschreibung (Längenbegrenzung + Steuerzeichen-Filter).
- **Firebase Realtime Database Rules** in [`firebase.rules.json`](./firebase.rules.json)
  beschränken Schreibrechte auf die jeweilige Rolle und validieren Datentypen,
  Wertebereiche und Längen.
- **Erzwungener Passwort-Wechsel** über nicht schließbares Modal (`aria-modal`,
  Focus Trap, gesperrter Hintergrund).

Siehe [`SECURITY.md`](./SECURITY.md) für den Umgang mit Sicherheitsmeldungen.

## Barrierefreiheit

Die App zielt auf **WCAG 2.2 Konformitätsstufe AA** und **EN 301 549** ab:

- Skip-Link als erstes fokussierbares Element.
- `role="dialog"` mit `aria-modal`, Focus-Trap und `Escape` für alle Modale
  (außer dem erzwungenen Passwort-Modal).
- Alle Buttons mit mindestens 44 × 44 px (WCAG 2.5.5 / 2.5.8 „Target Size“).
- `aria-label` auf Icon-Buttons, `role="navigation"` auf der Bottom-Nav,
  `aria-live` für Toast- und Chat-Updates.
- `prefers-reduced-motion` deaktiviert alle Animationen und Übergänge.
- `prefers-contrast: more` erhöht Ränder und Textkontrast.
- Schriftart **Inter** mit optimierter Lesbarkeit und tabellarischen Ziffern
  für Statistiken.

## Druckansicht

Jede Seite ist für **DIN A4** optimiert:

- Bottom-Navigation, Toasts, Modale und Header werden im Druck ausgeblendet.
- Karten erhalten schwarze Konturen und vermeiden Seitenumbrüche in der Mitte
  (`page-break-inside: avoid`).
- Links erscheinen mit ihrer URL in Klammern.

Drucken direkt im Header-Button oder per `Strg/⌘ + P`.

## Datenmodell

```
/users/{uid}
  username, displayName, role (user|admin|dev), mustChangePassword, fcmToken
/services/{sid}
  title, description, startMs, deadlineDays, minSlots, color,
  replacement, statsApplied, attendees/{uid}
/stats/{uid}
  attended, cancelled, lateCancelled
/chat/{mid}
  uid, username, displayName, text, ts, system
```

## Mitwirken

Beiträge sind willkommen! Lies bitte vorher:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) – Arbeitsweise, Commits, Code-Stil
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) – Umgang miteinander
- [`SECURITY.md`](./SECURITY.md) – Sicherheitsmeldungen

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](./LICENSE).
