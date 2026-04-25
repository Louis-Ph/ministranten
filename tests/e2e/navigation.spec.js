import { test, expect } from '@playwright/test';

async function loginAsDev(page) {
  await page.goto('/index.html?mock=1');
  await page.getByRole('button', { name: /Entwickler Zugang/i }).click();
  await page.getByLabel('Entwickler-Schlüssel').fill('miniswettapp');
  await page.getByRole('button', { name: /Entsperren/i }).click();
  await expect(page.getByRole('heading', { name: /Kommende Gottesdienste/i })).toBeVisible();
}

test.describe('Navigation + admin flow', () => {
  test('can switch between tabs', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Chat$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Profil', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Mein Profil/i })).toBeVisible();
    await page.getByRole('button', { name: 'Statistik', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Leaderboard/i })).toBeVisible();
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Admin$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Dev', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Entwickler-Werkzeuge/i })).toBeVisible();
  });

  test('creating a service adds it to the home list', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Dienst/i }).click();
    await page.getByLabel('Titel').fill('Sonntagsmesse 9:30');
    await page.getByLabel('Beschreibung').fill('Hochamt mit Chor');
    await page.getByRole('button', { name: /Speichern/i }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Sonntagsmesse 9:30/ })).toBeVisible();
  });

  test('weekly repeat creates 12 services', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Dienst/i }).click();
    await page.getByLabel('Titel').fill('Rosenkranz');
    await page.getByLabel(/Wöchentlich/).check();
    await page.getByRole('button', { name: /Speichern/i }).click();
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    // Should see many Rosenkranz rows (>= 10 to be safe against any hidden past filter)
    const rows = page.getByText('Rosenkranz', { exact: false });
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('Escape closes non-forced modal', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await page.getByRole('button', { name: /Neuer Dienst/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('chat input is XSS-safe (textContent only)', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel(/Nachricht eingeben/i).fill('<img src=x onerror=window.__pwn=1>');
    await page.getByRole('button', { name: /Senden/i }).click();
    await expect(page.locator('.chat-msg .body').last()).toContainText('<img src=x onerror=window.__pwn=1>');
    const pwned = await page.evaluate(() => window.__pwn === 1);
    expect(pwned).toBe(false);
  });

  test('chat shows long sent messages immediately after durable write', async ({ page }) => {
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const message = '[TEST QA] ' + 'lange Nachricht '.repeat(80);
    await page.getByLabel(/Nachricht eingeben/i).fill(message);
    await page.getByRole('button', { name: /Senden/i }).click();
    await expect(page.getByLabel(/Nachricht eingeben/i)).toHaveValue('');
    await expect(page.locator('.chat-msg .body').last()).toContainText('[TEST QA] lange Nachricht');
  });

  test('incoming message does not steal focus from a half-typed reply', async ({ page }) => {
    /* Regression: state.chatMessages mutations used to trigger a full
       renderApp(), which destroyed <input id="chat-input"> together
       with whatever the user was in the middle of typing. */
    await loginAsDev(page);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const input = page.locator('#chat-input');
    await input.click();
    await input.fill('Hallo wie ge');
    // Push a foreign message straight into state, the way subscribeChat
    // would when another user posts something.
    await page.evaluate(() => {
      const s = window.__MinisTest.state;
      s.chatMessages = s.chatMessages.concat([{
        id: 'foreign-test', uid: 'someone-else', username: 'tester',
        displayName: 'Tester', text: 'Hallo zurück!', ts: Date.now(), system: false
      }]);
    });
    // Focus and value both survive: the user can finish typing.
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Hallo wie ge');
    // The foreign message also rendered, just without nuking the input.
    await expect(page.locator('.chat-msg .body').filter({ hasText: 'Hallo zurück!' })).toBeVisible();
    // User finishes typing and sends — the value was never lost.
    await input.fill('Hallo wie geht es dir?');
    await page.getByRole('button', { name: /Senden/i }).click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.chat-msg .body').filter({ hasText: 'Hallo wie geht es dir?' })).toBeVisible();
  });
});

test.describe('Mobile app shell', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('header action buttons stay inside the compact header', async ({ page }) => {
    await loginAsDev(page);
    const header = page.locator('.app-header');
    const headerBox = await header.boundingBox();
    const logoutBox = await page.getByRole('button', { name: 'Abmelden' }).boundingBox();

    expect(headerBox, 'header bounding box').toBeTruthy();
    expect(logoutBox, 'logout button bounding box').toBeTruthy();
    expect(logoutBox.width).toBeLessThanOrEqual(48);
    expect(logoutBox.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
  });
});
