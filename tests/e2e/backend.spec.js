import { test, expect } from '@playwright/test';

async function devLogin(page) {
  await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
  await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
  await page.getByRole('button', { name: /Entsperren/i }).click();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
}

test.describe('Backend selector (Dev-Tools)', () => {
  test('current backend is shown and three options are offered', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await devLogin(page);
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Backend \/ Verbindung/i })).toBeVisible();
    await expect(page.getByText(/Derzeit aktiv:/i)).toBeVisible();
    const group = page.getByRole('radiogroup', { name: /Backend auswählen/i });
    await expect(group.getByLabel(/Firebase/)).toBeVisible();
    await expect(group.getByLabel(/SQLite/)).toBeVisible();
    await expect(group.getByLabel(/Mock/)).toBeVisible();
  });

  test('identical selection yields a neutral toast without reload', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await devLogin(page);
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    const url = page.url();
    await page.getByRole('button', { name: /Backend übernehmen/i }).click();
    await expect(page.getByText(/Kein Wechsel/i)).toBeVisible();
    expect(page.url()).toBe(url);
  });
});
