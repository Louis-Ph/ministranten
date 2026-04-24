import { test, expect } from '@playwright/test';

const DEMO = {
  mini: { username: 'mini', password: 'mini1234' },
  obermini: { username: 'obermini', password: 'obermini1234' },
  entwickler: { username: 'entwickler', password: 'entwickler1234' }
};

async function login(page, account, buttonName = 'Ministranten Login') {
  await page.goto('/index.html?mock=1');
  await page.getByLabel('Benutzername').fill(account.username);
  await page.getByLabel('Passwort').fill(account.password);
  await page.getByRole('button', { name: buttonName }).click();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
}

test.describe('Role-based access', () => {
  test('Ministrant sees only user functionality', async ({ page }) => {
    await login(page, DEMO.mini);

    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profil', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Statistik', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dev', exact: true })).toHaveCount(0);

    await page.evaluate(() => { window.__MinisTest.state.view = window.__MinisTest.VIEWS.ADMIN; });
    await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Admin$/ })).toHaveCount(0);
  });

  test('Obermini sees admin functionality but not developer tools', async ({ page }) => {
    await login(page, DEMO.obermini, 'Oberminis Login');

    await expect(page.getByRole('button', { name: 'Statistik', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dev', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Dienst/i }).click();
    await page.getByLabel('Titel').fill('Obermini Dienst');
    await page.getByRole('button', { name: /Speichern/i }).click();
    await expect(page.getByText('Obermini Dienst')).toBeVisible();
  });

  test('Entwickler sees developer tools and local demo accounts', async ({ page }) => {
    await login(page, DEMO.entwickler, 'Oberminis Login');

    await expect(page.getByRole('button', { name: 'Dev', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Rollen & Funktionen/i })).toBeVisible();
    await expect(page.getByText('Demo Ministrant', { exact: true })).toBeVisible();
    await expect(page.getByText('Demo Obermini', { exact: true })).toBeVisible();
    await expect(page.getByText('Demo Entwickler', { exact: true })).toBeVisible();
  });

  test('Oberminis Login rejects a plain Ministrant account', async ({ page }) => {
    await page.goto('/index.html?mock=1');
    await page.getByLabel('Benutzername').fill(DEMO.mini.username);
    await page.getByLabel('Passwort').fill(DEMO.mini.password);
    await page.getByRole('button', { name: 'Oberminis Login' }).click();

    await expect(page.getByText(/nur für Oberminis und Entwickler/i)).toBeVisible();
    await expect(page.getByLabel('Benutzername')).toBeVisible();
  });
});
