# Beitragen zu Minis Wettstetten

Vielen Dank, dass du überlegst, zu diesem Projekt beizutragen! Diese Richtlinie
soll helfen, Beiträge reibungslos zu gestalten und die Qualität der App
sicherzustellen.

## Verhaltenskodex

Bitte lies den [Verhaltenskodex](./CODE_OF_CONDUCT.md). Mit deinem Beitrag
erklärst du dich einverstanden, ihn einzuhalten.

## Sicherheitsmeldungen

Sicherheitsrelevante Probleme bitte **nicht** als öffentliches Issue melden.
Siehe [SECURITY.md](./SECURITY.md) für den Meldeweg.

## Wie kann ich beitragen?

### Fehler melden

1. Prüfe, ob der Fehler bereits im [Issue-Tracker](../../issues) steht.
2. Nutze die Bug-Report-Vorlage und beschreibe
   - Reproduktionsschritte
   - erwartetes und tatsächliches Verhalten
   - Browser, Betriebssystem, Gerät
   - Screenshots oder Konsolen-Ausgaben, falls relevant.

### Funktion vorschlagen

Erstelle ein Issue mit der Feature-Request-Vorlage. Erkläre den Nutzen für die
Zielgruppe (Ministranten, Oberminis, Verantwortliche) und mögliche Alternativen.

### Code-Beitrag

1. Fork anlegen, Feature-Branch erstellen (`feat/<kurzbeschreibung>` oder
   `fix/<kurzbeschreibung>`).
2. Änderungen umsetzen, Tests ergänzen.
3. Vor dem Commit lokale Prüfungen durchführen:
   ```bash
   npm run test:unit
   npm run test:e2e
   ```
4. Pull Request gegen `main` öffnen. Die PR-Vorlage ausfüllen.

## Entwicklungsumgebung

| Werkzeug   | Mindestversion |
|------------|----------------|
| Node.js    | 20             |
| npm        | 10             |
| Chromium   | durch Playwright automatisch bereitgestellt |

Installation:

```bash
npm install
npx playwright install chromium
npm run dev
```

## Code-Stil

- **Einrückung:** 2 Leerzeichen, keine Tabs.
- **Semikolons:** immer.
- **Strings:** Einfache Anführungszeichen (`'…'`), außer bei Texten mit
  Apostrophen.
- **Vanilla JavaScript:** Keine zusätzlichen Frameworks oder Libraries in
  `index.html`. Testabhängigkeiten dürfen via npm dazukommen.
- **DOM-Manipulation:** Nutze den eingebauten `h()`-Builder. Setze niemals
  `innerHTML` mit dynamischen bzw. nutzergenerierten Inhalten.
- **Kein `alert()` / `confirm()`:** Verwende den eingebauten Toast-Manager
  bzw. das Modal-System mit Focus-Trap.
- **Barrierefreiheit:** Jedes interaktive Element braucht einen sichtbaren
  Text oder ein `aria-label`. Modale benötigen `role="dialog"` und
  `aria-modal="true"`.
- **Zustandsänderungen:** ausschließlich über den globalen `state`-Proxy.

## Commits

Commits folgen [Conventional Commits](https://www.conventionalcommits.org/de/v1.0.0/):

```
feat: Passwort-Zwang auch im Profil anbieten
fix: Ersatzsuche-Toast bei Offline-Zustand verzögern
docs: README um Cloud-Deployment ergänzen
test: E2E-Test für Chat-Scroll-Verhalten
```

Referenzen auf Issues sind willkommen (`Closes #123`).

## Pull Requests

- Klein halten, ein Thema pro PR.
- Alle Tests müssen grün sein.
- Bei UI-Änderungen: Screenshot vor/nach anhängen.
- Bei Security- oder DSGVO-relevanten Änderungen: Auswirkungen beschreiben.

## Veröffentlichung

Nach dem Merge aktualisiert ein Maintainer `CHANGELOG.md` und vergibt ein
Git-Tag `vX.Y.Z`. Der Workflow in `.github/workflows/deploy.yml` veröffentlicht
die Anwendung auf GitHub Pages.
