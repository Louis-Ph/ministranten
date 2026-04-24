import { test, expect } from '@playwright/test';

async function devLogin(page) {
  await page.goto('/index.html?mock=1');
  await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
  await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
  await page.getByRole('button', { name: /Entsperren/i }).click();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
}

test.describe('User creation (Dev view)', () => {
  test('Dev sees "Neuer Benutzer" button and can create a user', async ({ page }) => {
    await devLogin(page);
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Benutzer/i }).click();
    await expect(page.getByRole('dialog', { name: /Neuer Benutzer/i })).toBeVisible();
    await page.getByLabel('Benutzername').fill('max');
    await page.getByLabel(/Anzeigename/).fill('Max Mustermann');
    await page.getByLabel(/Initiales Passwort/).fill('geheim123');
    await page.getByRole('button', { name: /^Anlegen$/ }).click();
    await expect(page.getByText(/Benutzer „max" angelegt/)).toBeVisible();
    // Modal closes
    await expect(page.getByRole('dialog', { name: /Neuer Benutzer/i })).toHaveCount(0);
    // Created user appears in the list
    await expect(page.getByText('Max Mustermann')).toBeVisible();
  });

  test('rejects short passwords and invalid usernames', async ({ page }) => {
    await devLogin(page);
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Benutzer/i }).click();
    // Invalid username (contains space -> must be rejected client-side)
    await page.getByLabel('Benutzername').fill('max mustermann');
    await page.getByLabel(/Initiales Passwort/).fill('geheim123');
    await page.getByRole('button', { name: /^Anlegen$/ }).click();
    await expect(page.getByText(/Ungültiger Benutzername/i)).toBeVisible();
    // Short password
    await page.getByLabel('Benutzername').fill('lisa');
    await page.getByLabel(/Initiales Passwort/).fill('abc');
    await page.getByRole('button', { name: /^Anlegen$/ }).click();
    await expect(page.getByText(/mindestens 8 Zeichen/i)).toBeVisible();
  });
});

test.describe('Desktop layout (bottom-nav becomes sidebar)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('on desktop, nav is a full-height sidebar, header sits next to it', async ({ page }) => {
    await devLogin(page);
    const nav = page.getByRole('navigation', { name: /Hauptnavigation/i });
    const box = await nav.boundingBox();
    expect(box, 'nav bounding box').toBeTruthy();
    // Sidebar: left edge = 0, spans full height, width ~240
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(200);
    expect(box.width).toBeLessThan(300);
    expect(box.height).toBeGreaterThan(600); // full height
    // Header starts to the right of the sidebar
    const header = page.locator('.app-header');
    const hBox = await header.boundingBox();
    expect(hBox.x).toBeGreaterThanOrEqual(box.width - 1);
  });
});
