import { test, expect } from '@playwright/test';

test('@media print hides navigation and toast, preserves services', async ({ page }) => {
  await page.goto('/index.html?mock=1');
  await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
  await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
  await page.getByRole('button', { name: /Entsperren/i }).click();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  // Bottom nav and toast container must not be visible in print mode
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('#toast-container')).toBeHidden();
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();

  // Produce an actual PDF to validate the page renders at A4
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(500);
});
