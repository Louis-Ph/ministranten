import { test, expect } from '@playwright/test';

test.describe('Login screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html?mock=1');
  });

  test('renders login card with accessible inputs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Minis Wettstetten' })).toBeVisible();
    await expect(page.getByLabel('Benutzername')).toBeVisible();
    await expect(page.getByLabel('Passwort')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ministranten Login/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Oberminis Login/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Entwickler Zugang/i })).toBeVisible();
  });

  test('skip link is reachable by keyboard', async ({ page }) => {
    // Focus the skip link directly and verify it is keyboard-focusable + visible.
    const skip = page.getByRole('link', { name: /Zum Inhalt springen/i });
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('dev masterkey unlocks the app (no Firebase call)', async ({ page }) => {
    await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
    await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
    await page.getByRole('button', { name: /Entsperren/i }).click();
    await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /Hauptnavigation/i })).toBeVisible();
  });

  test('wrong masterkey shows a toast and stays on login', async ({ page }) => {
    await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
    await page.getByLabel('Entwickler-Schlüssel').fill('nope');
    await page.getByRole('button', { name: /Entsperren/i }).click();
    await expect(page.getByText(/Falscher Entwickler-Schlüssel/i)).toBeVisible();
    await expect(page.getByLabel('Entwickler-Schlüssel')).toBeVisible();
  });
});
