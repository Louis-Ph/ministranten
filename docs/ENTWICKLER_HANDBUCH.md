# Entwickler-Handbuch (Minis Wettstetten)

Herzlich willkommen im Team! Dieses Handbuch bietet einen schnellen Überblick über die Architektur der Anwendung, insbesondere nach der Migration auf die Nx-Monorepo-Struktur, und erklärt die gängigsten Arbeitsabläufe.

## Architektur: Nx Monorepo

Das Projekt nutzt **Nx** zur Koordination, um Front-End, Back-End und Tests sauber strukturell zu trennen, während alles in einem Repository bleibt.

| Verzeichnis | Nx-Projektname | Zweck |
| ----------- | ---------------| ------|
| `/` (Root)  | `web` | PWA Frontend (Vanilla JS, HTML, CSS). Enthält die UI ohne externe React/Vue Libraries. |
| `/api`      | `api` | Serverless Backend (Vercel API Routes in TypeScript). Regelt die Kommunikation mit Supabase. |
| `/tests`    | `test`| E2E (Playwright) und Unit Evaluierungen (Vitest). Testet die Stabilität beider Schichten. |

## Lokale Entwicklungsumgebung starten

Stelle sicher, dass du mindestens **Node.js 20+** installiert hast.

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Lokale Variablen setzen (falls Cloud-Zugang benötigt)
# Kopiere .env.example zu .env.local und trage deine Schlüssel ein.

# 3. PWA-Frontend entwicklungsserver starten (Läuft auf port 8080)
npm run dev

# 4. Backend (Vercel API) entwicklungsserver starten
npm run dev:api
```

## Nützliche Nx-Kommandos

Wir haben die wichtigsten Kommandos in der `package.json` hinterlegt, damit du sie über `npm` aufrufen kannst. Dahinter führt Nx diese parallel und hochgradig gecacht aus (Dank Nx Cloud).

### Typen prüfen (TypeScript)
```bash
npm run typecheck
```
*Geprüft werden parallel das Root-Projekt (`web`) und das `api`-Projekt isoliert über ihre eigenen `tsconfig`-Dateien.*

### Tests ausführen
Wir unterscheiden zwischen Unit-Tests (für Geschäftslogik) und E2E-Tests (End-to-End mit echtem Chromium-Browser).

```bash
# Alle Unit Tests ausführen (über das test-Projekt)
npm run test:unit

# E2E Playwright Tests ausführen (Downloadet Chromium falls nötig)
npm run test:e2e
```

### Projekt bauen
```bash
npm run build
```
Dies bereitet die Production-Assets vor. Das Frontend kopiert die `index.html` und Assets in `dist/web`, während die TypeScript API validiert und gebaut wird.

## Deployment auf Vercel

Dank der Konfigurationsdatei `vercel.json` gibt es keinen zusätzlichen Einrichtungsaufwand in der Vercel-Cloud (Zero-Config).

1. Ein Deployment auf dem `main` Branch wird automatisch in Vercel als **Production** ausgeliefert.
2. Vercel führt den Befehl `npm run build` (ergo `nx run-many --target=build --all`) aus.
3. Die Dateien in `dist/web` werden dem Besucher als Website serviert.
4. Alle TypeScript-Dateien im Ordner `/api` werden automatisch von Vercel kompiliert und unter den Routes `https://.../api/*` bereitgestellt.

### Wichtig: Service-Role-Key
Sichere Back-End Zugriffe auf Supabase erfolgen über `SUPABASE_SERVICE_ROLE_KEY`. Dieser Schlüssel darf **niemals** in das Frontend übertragen werden. Er wird nur vom `api`-Ordner ausgelesen und muss im Vercel Dashboard unter *Project Settings > Environment Variables* hinterlegt werden.

---
Viel Spaß beim Entwickeln und bei der Wartung des Dienstplans!
