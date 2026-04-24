import { describe, it, expect, beforeAll } from 'vitest';
import { loadApp } from './helpers.js';

let T;
beforeAll(async () => { T = await loadApp(); });

describe('isLateCancellation', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00 UTC
  it('is late when inside the deadline window', () => {
    const start = now + 2 * T.DAY_MS; // 2 days away
    expect(T.isLateCancellation(start, 3, now)).toBe(true);
  });
  it('is not late when outside the deadline window', () => {
    const start = now + 5 * T.DAY_MS;
    expect(T.isLateCancellation(start, 3, now)).toBe(false);
  });
  it('is late when the service is in the past', () => {
    const start = now - 1 * T.DAY_MS;
    expect(T.isLateCancellation(start, 3, now)).toBe(true);
  });
  it('zero deadline means never late (until the service starts)', () => {
    const start = now + 1 * T.DAY_MS;
    expect(T.isLateCancellation(start, 0, now)).toBe(false);
    expect(T.isLateCancellation(now - 1, 0, now)).toBe(true);
  });
});

describe('generateWeeklySeries', () => {
  it('produces exactly N entries spaced by 7 days', () => {
    const start = Date.UTC(2026, 0, 1);
    const series = T.generateWeeklySeries(start, 12);
    expect(series.length).toBe(12);
    expect(series[0]).toBe(start);
    expect(series[11]).toBe(start + 11 * 7 * T.DAY_MS);
    for (let i = 1; i < series.length; i++) {
      expect(series[i] - series[i - 1]).toBe(7 * T.DAY_MS);
    }
  });
  it('clamps to at least 1 and at most 52', () => {
    expect(T.generateWeeklySeries(0, 0).length).toBe(1);
    expect(T.generateWeeklySeries(0, 999).length).toBe(52);
  });
});

describe('usernameToEmail / validUsername / validPassword', () => {
  it('lowercases and appends @minis-wettstetten.de', () => {
    expect(T.usernameToEmail('Max ')).toBe('max@minis-wettstetten.de');
    expect(T.usernameToEmail('Lena.M')).toBe('lena.m@minis-wettstetten.de');
  });
  it('accepts valid usernames', () => {
    expect(T.validUsername('max')).toBe(true);
    expect(T.validUsername('lena.m_1')).toBe(true);
    expect(T.validUsername('a-b')).toBe(true);
  });
  it('rejects bad usernames', () => {
    expect(T.validUsername('')).toBe(false);
    expect(T.validUsername('x')).toBe(false);
    expect(T.validUsername('has space')).toBe(false);
    expect(T.validUsername('uml$ut')).toBe(false);
  });
  it('requires >=8 char passwords', () => {
    expect(T.validPassword('abcdefgh')).toBe(true);
    expect(T.validPassword('abc')).toBe(false);
    expect(T.validPassword(null)).toBe(false);
  });
});

describe('sanitizePlainText', () => {
  it('strips ASCII control characters', () => {
    const CTRL = String.fromCharCode(0x01, 0x02, 0x07, 0x1F, 0x7F);
    const s = 'hi ' + CTRL + 'there';
    expect(T.sanitizePlainText(s)).toBe('hi there');
  });
  it('preserves printable characters including umlauts', () => {
    expect(T.sanitizePlainText('Grüß Gott — Messe')).toBe('Grüß Gott — Messe');
  });
  it('returns empty string for null/undefined', () => {
    expect(T.sanitizePlainText(null)).toBe('');
    expect(T.sanitizePlainText(undefined)).toBe('');
  });
});

describe('mapAuthError', () => {
  it('maps user-not-found', () => {
    expect(T.mapAuthError({ code: 'auth/user-not-found' })).toMatch(/nicht gefunden/);
  });
  it('maps wrong-password', () => {
    expect(T.mapAuthError({ code: 'auth/wrong-password' })).toMatch(/Falsches Passwort/);
  });
  it('falls back to generic message', () => {
    expect(T.mapAuthError({ message: 'boom' })).toMatch(/boom/);
  });
});
