import { describe, it, expect, beforeAll } from 'vitest';
import { loadApp } from './helpers.js';

let T;
beforeAll(async () => { T = await loadApp(); });

describe('backend settings', () => {
  it('exposes the three backend identifiers', () => {
    expect(T.BACKENDS).toMatchObject({ CLOUD: 'cloud', SQLITE: 'sqlite', MOCK: 'mock' });
  });
  it('provides a human-readable label for each backend', () => {
    expect(T.BACKEND_LABELS.cloud).toMatch(/Vercel \+ Supabase/);
    expect(T.BACKEND_LABELS.sqlite).toMatch(/SQLite/);
    expect(T.BACKEND_LABELS.mock).toMatch(/Mock/);
  });
  it('writeBackendSetting accepts each valid backend without throwing', () => {
    // happy-dom provides no real localStorage; the function is also called in the
    // e2e tests which run in a real browser – so we simply assert it does not throw.
    expect(() => T.writeBackendSetting(T.BACKENDS.CLOUD)).not.toThrow();
    expect(() => T.writeBackendSetting(T.BACKENDS.SQLITE)).not.toThrow();
    expect(() => T.writeBackendSetting(T.BACKENDS.MOCK)).not.toThrow();
  });
  it('rejects unknown backend identifiers', () => {
    expect(() => T.writeBackendSetting('nonsense')).toThrow();
  });
  it('test runtime always boots in mock (via ?mock=1)', () => {
    expect(T.activeBackend).toBe(T.BACKENDS.MOCK);
  });
});
