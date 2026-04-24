import { describe, it, expect, beforeAll } from 'vitest';
import { loadApp } from './helpers.js';

let T;
beforeAll(async () => { T = await loadApp(); });

describe('date utilities', () => {
  it('DAY_MS equals 24*60*60*1000', () => {
    expect(T.DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
  it('addDays offsets by whole days', () => {
    const base = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(T.addDays(base, 7)).toBe(base + 7 * T.DAY_MS);
    expect(T.addDays(base, -1)).toBe(base - T.DAY_MS);
  });
  it('daysBetween is signed and real-valued', () => {
    const a = 0, b = T.DAY_MS * 3;
    expect(T.daysBetween(a, b)).toBe(3);
    expect(T.daysBetween(b, a)).toBe(-3);
    expect(T.daysBetween(0, T.DAY_MS * 0.5)).toBe(0.5);
  });
  it('isPast respects the supplied "now"', () => {
    expect(T.isPast(1000, 2000)).toBe(true);
    expect(T.isPast(3000, 2000)).toBe(false);
  });
  it('parseDateTimeLocal roundtrips localDateTimeInputValue', () => {
    const ms = Date.UTC(2026, 5, 10, 14, 30, 0);
    const s = T.localDateTimeInputValue(ms);
    const back = T.parseDateTimeLocal(s);
    // Must be within one minute (seconds truncated)
    expect(Math.abs(back - ms)).toBeLessThan(60 * 1000);
  });
});
