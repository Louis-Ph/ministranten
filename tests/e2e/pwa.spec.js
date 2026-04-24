import { test, expect } from '@playwright/test';

test.describe('PWA installability', () => {
  test('manifest.webmanifest is served with proper fields', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const ct = res.headers()['content-type'] || '';
    expect(ct.toLowerCase()).toMatch(/manifest\+json|application\/json/);
    const json = await res.json();
    expect(json.name).toBe('Minis Wettstetten');
    expect(json.short_name).toBeTruthy();
    expect(json.start_url).toBeTruthy();
    expect(json.scope).toBeTruthy();
    expect(json.display).toBe('standalone');
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThanOrEqual(2);
    const sizes = json.icons.map(i => i.sizes).join(' ');
    expect(sizes).toMatch(/192/);
    expect(sizes).toMatch(/512/);
  });

  test('sw.js is served as JavaScript', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.ok()).toBe(true);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toMatch(/addEventListener\('fetch'/);
    expect(body).toMatch(/addEventListener\('install'/);
  });

  test('icon files exist (svg + png 192 + png 512)', async ({ request }) => {
    for (const p of ['/icon.svg', '/icon-192.png', '/icon-512.png']) {
      const res = await request.get(p);
      expect(res.ok(), p + ' should be reachable').toBe(true);
    }
  });

  test('index.html links to real manifest and icons', async ({ page }) => {
    await page.goto('/index.html');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('./manifest.webmanifest');
    const icons = await page.locator('link[rel="icon"]').count();
    expect(icons).toBeGreaterThanOrEqual(2);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });

  test('service worker registers and controls the page', async ({ page }) => {
    await page.goto('/index.html');
    // Warte, bis der SW die Kontrolle übernimmt oder bereits aktiv ist.
    const controller = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const reg = await navigator.serviceWorker.ready;
      return reg && (reg.active || reg.installing || reg.waiting) ? 'ok' : null;
    });
    expect(controller).toBe('ok');
  });
});
