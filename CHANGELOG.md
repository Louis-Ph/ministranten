# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei
dokumentiert. Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)
und die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geändert

- Produktivarchitektur auf Vercel API Routes + Supabase Postgres/Auth
  umgestellt.
- Cloud-Zugangsdaten aus dem Browser entfernt; Runtime-Secrets liegen nur noch
  in Vercel-Umgebungsvariablen.
- Backend-Auswahl nutzt jetzt Cloud / SQLite / Mock.
- OAuth-Start für Google, GitHub und Microsoft vorbereitet; Apple bleibt
  kostenbewusstes Opt-in.
- Cloud-Datenzugriff läuft über `/api/data` mit serverseitiger Rollenprüfung.

### Hinzugefügt

- `api/*` Gateway-Routen für Auth, Datenzugriff, Benutzeranlage und Healthcheck.
- `supabase/schema.sql` mit RLS-geschütztem 3NF-Tabellenschema.
- `vercel.json`, `.env.example` und Deployment-Dokumentation.
- Unit-Tests für Cloud-Konfiguration, Vercel-Headers und RLS-Schema.

### Behoben

- Browser-Console-Warnings bei CSP, CDN-SRI und Service-Worker-Caching wurden
  bereinigt.
- Desktop-Layout und Pflicht-Passwortmodal wurden stabilisiert.

## [1.0.0] – 2026-04-24

### Hinzugefügt

- Monolithische PWA (`index.html`) mit Vanilla JavaScript und internem CSS.
- Rollenbasiertes Modell (`user`, `admin`, `dev`) inklusive lokalem
  Entwickler-Masterkey.
- Dienstplaner mit Abmeldefristen, Serien-Anlage, Ersatzsuche und Chat.
- Statistik-Dashboard, Benutzerverwaltung, Backup, PWA-Manifest und
  Service Worker.
- Testinfrastruktur mit Vitest, happy-dom und Playwright.

[Unveröffentlicht]: https://github.com/CHANGEME/ministranten/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CHANGEME/ministranten/releases/tag/v1.0.0
