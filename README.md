# Minis Wettstetten

> Dienstplan, Chat und Verwaltung für die Ministrantinnen und Ministranten der
> Pfarrei Wettstetten. Installierbare PWA mit Vanilla JavaScript, Vercel API
> Routes, Supabase Auth und Supabase Postgres.

<p align="left">
  <a href="./LICENSE"><img alt="Lizenz: MIT" src="https://img.shields.io/badge/Lizenz-MIT-0066cc?style=flat-square"></a>
  <img alt="PWA" src="https://img.shields.io/badge/PWA-installierbar-0066cc?style=flat-square">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/Vanilla%20JS-ES2020%2B-1d3557?style=flat-square">
  <img alt="Vercel" src="https://img.shields.io/badge/Deploy-Vercel-1d3557?style=flat-square">
  <img alt="Supabase" src="https://img.shields.io/badge/DB-Supabase%20Postgres-00cc88?style=flat-square">
  <img alt="WCAG 2.2 AA" src="https://img.shields.io/badge/WCAG%202.2-AA-00cc88?style=flat-square">
</p>

## Architektur

Die App ist weiterhin bewusst klein und direkt: `index.html` enthält die PWA,
die Views und die Businesslogik. Produktivdaten laufen aber nicht mehr direkt
aus dem Browser in eine Datenbank. Der Cloud-Betrieb ist jetzt so getrennt:

| Ebene | Zweck |
|-------|-------|
| `index.html` | PWA, UI, Rollenlogik, Mock/SQLite-Fallback |
| `api/*` | Vercel Node.js API Routes, Auth- und Daten-Gateway |
| `supabase/schema.sql` | Supabase Postgres Schema in 3NF mit RLS |
| `.env.example` | Dokumentierte Runtime-Variablen ohne echte Secrets |
| `vercel.json` | Vercel Routing und Sicherheitsheader |

Der Browser sieht keine Datenbank-Passwörter und keinen Service-Role-Key.
Schreib- und Lesezugriffe gehen über `/api/data`, `/api/users` und
`/api/auth/*`; dort werden Supabase-Session und App-Rolle geprüft.

## Funktionen

- Rollenmodell: Ministrant, Obermini, Entwickler.
- Dienstplaner mit Serien-Anlage, Abmeldefristen und Ersatzsuche.
- Chat mit Systemmeldungen und XSS-sicherer Ausgabe über `textContent`.
- Statistik und druckbares Leaderboard.
- Benutzerverwaltung im Entwicklerbereich.
- Pflicht-Passwortwechsel und freiwilliger Passwortwechsel im Profil.
- OAuth-Start für Google, GitHub und Microsoft über Supabase Auth.
- Apple OAuth bleibt optional, weil es nur mit Apple Developer Program oder
  bewilligter Gebührenbefreiung wirklich kostenlos bleibt.
- Umschaltbare Backends: Cloud, SQLite lokal, Mock im Arbeitsspeicher.

## Cloud-Backend

| Backend | Einsatzgebiet | Persistenz | Auth |
|---------|---------------|------------|------|
| Cloud | Produktivbetrieb | Supabase Postgres über Vercel API | Supabase Auth, OAuth + Passwort |
| SQLite | Lokaler Testbetrieb | IndexedDB mit sql.js WASM | Lokales PBKDF2 |
| Mock | Unit/E2E-Tests | Arbeitsspeicher | Demo-Konten |

### Runtime-Variablen

Die Werte gehören in Vercel Project Settings oder lokal in `.env.local`.
`.env.local` ist gitignored.

```env
SUPABASE_URL=https://uvsgzvzttsohcmsnfgla.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_tIgL-ThuxWBDOcwrf6kXYQ_0_OPWmcs
SUPABASE_SERVICE_ROLE_KEY=
APP_BASE_URL=
APP_OAUTH_PROVIDERS=google,github,azure
APP_ALLOWED_EMAIL_DOMAINS=
```

Details stehen in [docs/deployment/vercel-supabase.md](./docs/deployment/vercel-supabase.md).

## Schnellstart

```bash
npm install
npm run dev
```

Ohne Cloud-Zugang:

```bash
open "http://localhost:8080/index.html?mock=1"
```

Mit Vercel-ähnlicher lokaler Umgebung:

```bash
vercel env pull .env.local
vercel dev
```

## Tests

| Schicht | Werkzeug | Anzahl | Schwerpunkt |
|---------|----------|--------|-------------|
| Unit | Vitest + happy-dom | 55 | Datumslogik, Businesslogik, DOM-Builder, Rollen, Cloud-Konfiguration, Browser-Sicherheitsmetadata |
| E2E | Playwright | 26 x 2 Projekte | Login, Dev-Masterkey, Rollen, Benutzeranlage, Navigation, Layout, Druckansicht |

```bash
npm run test:unit
npm run test:e2e
npm run test
```

## Sicherheit

- Keine Secrets im Browserbundle.
- Supabase `service_role` nur serverseitig in Vercel Runtime-Variablen.
- Produktivdaten liegen in normalisierten Tabellen (`app_users`,
  `service_events`, `service_attendees`, `user_stats`, `chat_messages`).
- Alle App-Tabellen haben RLS aktiv und verweigern direkten Clientzugriff.
- API-Routen prüfen Supabase JWT, App-Rolle und Pfadberechtigung.
- CSP begrenzt Skripte, Styles, Fonts und Cloud-Verbindungen.
- Dynamische Nutzerdaten werden nicht per `innerHTML` gerendert.
- OAuth-Anbieter werden zentral in Supabase Auth und `APP_OAUTH_PROVIDERS`
  konfiguriert.

## Deployment

1. Supabase-Projekt erstellen.
2. `supabase/schema.sql` ausführen.
3. OAuth-Anbieter Google, GitHub und Azure (Microsoft) aktivieren.
4. Vercel-Projekt mit dem Repository verbinden.
5. Runtime-Variablen aus `.env.example` in Vercel setzen.
6. Production-Deployment auf `main` oder per Vercel Git Integration auslösen.

## Barrierefreiheit

Die App zielt auf WCAG 2.2 AA und EN 301 549:

- Skip-Link als erstes fokussierbares Element.
- Dialoge mit `role="dialog"`, `aria-modal` und Focus-Trap.
- Tastaturbedienbare Navigation.
- `aria-live` für Toast- und Chat-Updates.
- `prefers-reduced-motion` und `prefers-contrast` werden respektiert.

## Lizenz

MIT, siehe [LICENSE](./LICENSE).
