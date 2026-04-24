# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)
und die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Behoben

- **Desktop-Layout kaputt** – Der `@media (min-width: 960px)`-Block stand im
  Stylesheet vor den Basisregeln für `.bottom-nav`, `.app-header` und
  `.main-content`; bei gleicher Spezifität gewann damit die (später
  deklarierte) Basisregel, sodass auf ≥ 960 px die Sidebar als 240×72-Miniblock
  am Header klebte und ein horizontaler Scroll entstand. Der Desktop-Override
  wurde hinter die Basisregeln verschoben.
- **Pflicht-Passwortwechsel erforderte zwei Klicks** – Der Button hatte kein
  explizites `type` und landete damit auf `submit`, ohne dass ein umgebendes
  `<form>` existierte; Browser verschluckten den ersten Klick. Jetzt ist der
  gesamte Dialog in ein `<form novalidate onsubmit>` eingebettet, die Enter-
  Taste submittet ebenfalls.

### Hinzugefügt

- **Benutzer anlegen (Dev-Ansicht)** – Neuer Button „Neuer Benutzer" mit
  Modal (Benutzername, Anzeigename, initiales Passwort, Rolle,
  Passwortwechsel erzwingen). Jedes Backend liefert eine eigene
  `createUser`-Implementierung:
  - **Firebase**: zweite App-Instanz (`__userCreate`), damit die aktive
    Admin-Session nicht überschrieben wird.
  - **SQLite**: PBKDF2-Hash + Salz, `INSERT` mit Uniqueness-Check.
  - **Mock**: direkter Write in den In-Memory-Store.
- **SQLite-Backend** (`sql.js`-WASM + IndexedDB-Persistenz) als administrativ
  wählbare Alternative zur Firebase-Verbindung. Relationales Schema mit
  Indizes, PBKDF2-gehashten Passwörtern und Seed-Admin-Account beim ersten
  Start.
- **Backend-Auswahl in der Dev-Ansicht** mit Radio-Gruppe
  (Firebase / SQLite / Mock), Persistenz im `localStorage`-Schlüssel
  `minis.backend` und URL-Overrides (`?backend=…`).
- Option zum Zurücksetzen der lokalen SQLite-Datenbank (Dev-Ansicht).
- CSP um `wasm-unsafe-eval` und `cdnjs.cloudflare.com` in `connect-src`
  erweitert.
- **PWA-Installierbarkeit**: echtes `manifest.webmanifest`, separater `sw.js`
  mit Scope `./`, sowie `icon.svg`, `icon-192.png`, `icon-512.png` (plus
  maskable-Varianten). Der Browser zeigt nun den „Installieren"-Hinweis.
- Icon-Generator-Skript `scripts/make-icons.mjs` (nutzt das bereits
  installierte Playwright-Chromium).

### Geändert

- Service-Worker wird primär aus `./sw.js` registriert; der bisherige
  Blob-URL-Pfad bleibt ausschließlich als Fallback (z. B. `file://`).
- Das inline Blob-Manifest wird nur noch eingeblendet, wenn
  `./manifest.webmanifest` nicht erreichbar ist.

## [1.0.0] – 2026-04-24

### Hinzugefügt

- Monolithische Single-File-PWA (`index.html`) mit Vanilla JavaScript,
  internem CSS und Firebase Compat v9 über CDN.
- Rollenbasiertes Authentifizierungsmodell (`user`, `admin`, `dev`) inklusive
  Entwickler-Masterkey für lokalen Zugang ohne Firebase-Call.
- Erzwungener Passwort-Wechsel über unschließbares Vollbild-Modal
  (`role="dialog"`, `aria-modal`, Focus-Trap).
- Dienstplaner mit `datetime-local`, Mindest-Teilnehmerzahl, farbigem
  Linksrand, Abmeldefrist und Serien-Anlage „12 Termine wöchentlich“ via
  `Promise.all`.
- Ersatzsuche-Logik: Austragen nach Fristablauf erhöht `lateCancelled`,
  markiert den Dienst als `replacement: true`, lässt die Karte rot blinken
  und postet eine rote Systemnachricht im Chat.
- Statistik-Dashboard mit Leaderboard (nach `attended` sortiert),
  exklusiv für Admins und Devs.
- Globaler Chat mit `limitToLast(40)`, Systemnachrichten-Hervorhebung und
  Auto-Hinweis-Toast bei Meldungen jünger als zwei Stunden.
- Firebase Cloud Messaging: Permission-Abfrage, Token-Speicherung unter
  `users/{uid}/fcmToken` und In-App-Toast bei Vordergrund-Nachrichten.
- Datenbank-Backup (Dev): Export der gesamten RTDB als JSON-Datei, Import
  mit Bestätigungs-Modal.
- Service Worker als Blob-URL registriert, `Network-first`-Caching-Strategie,
  Push- und `notificationclick`-Handler.
- Drucktaugliche Ansichten: `@media print` für DIN A4 mit Seitenumbruch-Logik,
  schwarz-weiß-freundlicher Karten-Stil.
- Barrierefreiheit nach WCAG 2.2 AA / EN 301 549: Skip-Link, `aria-label`,
  Mindest-Touch-Target 44 × 44 px, `prefers-reduced-motion`,
  `prefers-contrast: more`.
- Sicherheit: Content-Security-Policy als `<meta>`, SRI auf CDN-CSS,
  strikte Längen-/Typ-Validierung in Firebase-Rules.
- Testinfrastruktur: 30 Unit-Tests (Vitest + happy-dom) und 10 E2E-Tests
  (Playwright, Desktop + Mobile) inklusive eines Mock-Firebase-Modus
  (`?mock=1`) für netzwerkfreie Tests.
- GitHub-Repo-Präsentation: README, CHANGELOG, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, Issue- und PR-Templates, CI- und
  Deploy-Workflows.

[Unveröffentlicht]: https://github.com/CHANGEME/ministranten/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CHANGEME/ministranten/releases/tag/v1.0.0
