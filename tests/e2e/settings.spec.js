import { test, expect } from '@playwright/test';

const FAB = '#settings-fab';
const HEADER_GEAR = '.app-header button[aria-label="Einstellungen öffnen"]';

test.describe('Settings (gear icon, themes, Doku)', () => {
  test('floating gear is visible on the login screen and opens the modal', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await expect(page.locator(FAB)).toBeVisible();
    await page.locator(FAB).click();
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
    // Both tabs are present, themes is the default.
    await expect(page.getByRole('tab', { name: /Themes/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Dokumentation/ })).toBeVisible();
    // Six themes — default + 5 Streber ports.
    await expect(page.locator('.theme-card')).toHaveCount(6);
  });

  test('switching to a theme persists across reload and applies data-theme', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    // Start clean: ensure we are on default before switching.
    await page.evaluate(() => localStorage.removeItem('minis.theme'));
    await page.reload();

    await page.locator(FAB).click();
    await page.getByRole('button', { name: /Streber Smoked Gold/ }).click();

    // data-theme attribute applied immediately.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'streber-smoked-gold');
    // localStorage was written.
    const stored = await page.evaluate(() => localStorage.getItem('minis.theme'));
    expect(stored).toBe('streber-smoked-gold');
    // meta theme-color was updated for the browser chrome.
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#ba934e');

    // Reload — the theme stays.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'streber-smoked-gold');
  });

  test('Dokumentation tab shows German user manual headings', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await page.locator(FAB).click();
    await page.getByRole('tab', { name: /Dokumentation/ }).click();
    // A few section headings the user can scan for.
    await expect(page.getByRole('heading', { name: /Was ist Minis Wettstetten/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Anmelden$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Themes$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /App installieren/ })).toBeVisible();
  });

  test('logged-in header carries the gear button instead of the floating FAB', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
    await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
    await page.getByRole('button', { name: /Entsperren/i }).click();
    await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/ })).toBeVisible();

    // Header gear is in the actions row.
    await expect(page.locator(HEADER_GEAR)).toBeVisible();
    // The floating FAB is hidden via CSS (display:none) when the header is
    // rendered, so the user only ever sees one gear button at a time.
    await expect(page.locator(FAB)).toHaveCSS('display', 'none');

    // The header gear opens the same modal.
    await page.locator(HEADER_GEAR).click();
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  });
});
