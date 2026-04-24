import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

/**
 * Load the monolithic index.html into the current happy-dom window.
 * Forces `?mock=1` via history API so the app uses its in-memory Firebase stand-in.
 * Returns `window.__MinisTest`.
 */
export async function loadApp() {
  const doc = globalThis.document;
  const win = globalThis.window;

  // Provide a Firebase global for the defensive branch in the inline script.
  if (!win.firebase) {
    win.firebase = {
      initializeApp: () => {},
      database: () => ({ ref: () => ({ on: () => {}, once: async () => ({ val: () => null }) }) }),
      auth: () => ({ onAuthStateChanged: () => {}, signInWithEmailAndPassword: async () => ({}), signOut: async () => {}, currentUser: null }),
      messaging: () => null
    };
  }

  // Stub service worker – happy-dom doesn't implement it.
  if (!win.navigator.serviceWorker) {
    try {
      Object.defineProperty(win.navigator, 'serviceWorker', {
        value: { register: async () => {} },
        configurable: true
      });
    } catch (_) {}
  }

  // Force mock mode via the URL search (safe across happy-dom versions).
  try { win.history.replaceState({}, '', '/?mock=1'); } catch (_) {}

  // Reset DOM roots expected by the app.
  doc.body.innerHTML = `
    <div id="toast-container" role="status" aria-live="polite"></div>
    <div id="app"></div>
    <div id="modal-root"></div>
  `;

  // Extract and execute the inline <script> that contains the app.
  const match = INDEX_HTML.match(/<script>\s*\/\*([\s\S]*?)\*\/([\s\S]*?)<\/script>\s*<\/body>/);
  const source = match ? ('/*' + match[1] + '*/' + match[2]) : null;
  if (!source) {
    // Fallback: naive last <script> block
    const all = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    if (!all.length) throw new Error('No inline <script> block found.');
    // eslint-disable-next-line no-new-func
    new Function(all[all.length - 1][1]).call(win);
  } else {
    // eslint-disable-next-line no-new-func
    new Function(source).call(win);
  }

  if (!win.__MinisTest) throw new Error('window.__MinisTest was not exposed by the app.');
  return win.__MinisTest;
}
