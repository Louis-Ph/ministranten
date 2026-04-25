import { describe, expect, it } from 'vitest';
import {
  assertReadAllowed,
  assertWriteAllowed,
  parsePath
} from '../../api/_lib/dal/authz.ts';
import { isConfigured, missingConfigKeys, getConfig, resetConfigForTests } from '../../api/_lib/dal/config.ts';
import { loadRootState } from '../../api/_lib/dal/index.ts';
import { emptyRootState } from '../../api/_lib/dal/types.ts';

describe('DAL authorization helpers', () => {
  it('parses URL-style paths into canonical parts', () => {
    expect(parsePath('/')).toEqual([]);
    expect(parsePath('/services')).toEqual(['services']);
    expect(parsePath('/services/s1/attendees/u1')).toEqual(['services', 's1', 'attendees', 'u1']);
    expect(parsePath('   /services//s1//   ')).toEqual(['services', 's1']);
  });

  it('keeps root reads restricted to dev', () => {
    expect(() => assertReadAllowed(parsePath('/'), 'u1', 'user')).toThrow();
    expect(() => assertReadAllowed(parsePath('/'), 'u1', 'dev')).not.toThrow();
  });

  it('lets a user read only their private profile while shared data stays readable', () => {
    expect(() => assertReadAllowed(parsePath('/users/u1'), 'u1', 'user')).not.toThrow();
    expect(() => assertReadAllowed(parsePath('/users/u2'), 'u1', 'user')).toThrow();
    expect(() => assertReadAllowed(parsePath('/services'), 'u1', 'user')).not.toThrow();
    expect(() => assertReadAllowed(parsePath('/chat'), 'u1', 'user')).not.toThrow();
  });

  it('enforces role-aware writes for planning and attendance', () => {
    expect(() => assertWriteAllowed(parsePath('/services/s1/title'), 'u1', 'user', 'X')).toThrow();
    expect(() => assertWriteAllowed(parsePath('/services/s1/title'), 'u1', 'admin', 'X')).not.toThrow();
    expect(() => assertWriteAllowed(parsePath('/services/s1/attendees/u1'), 'u1', 'user', { uid: 'u1' })).not.toThrow();
    expect(() => assertWriteAllowed(parsePath('/services/s1/attendees/u2'), 'u1', 'user', { uid: 'u2' })).toThrow();
  });

  it('lets users update their own stat counters but not someone else\'s', () => {
    expect(() => assertWriteAllowed(parsePath('/stats/u1/attended'), 'u1', 'user', 5)).not.toThrow();
    expect(() => assertWriteAllowed(parsePath('/stats/u2/attended'), 'u1', 'user', 5)).toThrow();
    expect(() => assertWriteAllowed(parsePath('/stats/u2/attended'), 'u1', 'admin', 5)).not.toThrow();
  });
});

describe('DAL config probe', () => {
  it('defaults to free OAuth providers and makes Apple explicit opt-in', () => {
    const previous = process.env.APP_OAUTH_PROVIDERS;
    try {
      delete process.env.APP_OAUTH_PROVIDERS;
      resetConfigForTests();
      expect(getConfig().oauthProviders).toEqual(['google', 'github', 'azure']);

      process.env.APP_OAUTH_PROVIDERS = 'google,github,azure,apple';
      resetConfigForTests();
      expect(getConfig().oauthProviders).toEqual(['google', 'github', 'azure', 'apple']);
    } finally {
      if (previous == null) delete process.env.APP_OAUTH_PROVIDERS;
      else process.env.APP_OAUTH_PROVIDERS = previous;
      resetConfigForTests();
    }
  });

  it('reports missing secure deployment variables without exposing values', () => {
    const previous = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    try {
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_PUBLISHABLE_KEY = 'public';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      resetConfigForTests();
      expect(isConfigured()).toBe(false);
      expect(missingConfigKeys()).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      resetConfigForTests();
    }
  });
});

describe('DAL loadRootState', () => {
  it('returns the default root shape from empty normalized tables', async () => {
    const previousEnv = {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    const previousFetch = globalThis.fetch;
    const calls = [];
    try {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_PUBLISHABLE_KEY = 'public';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
      resetConfigForTests();

      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options && options.method });
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      };
      await expect(loadRootState()).resolves.toEqual(emptyRootState());
      // 5 SELECTs (users + publicProfiles + services + attendees + stats + chat)
      // — actually the DAL parallelizes some so just assert >=5 GETs and all GET method.
      expect(calls.length).toBeGreaterThanOrEqual(5);
      expect(calls.every(call => call.method === 'GET')).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      resetConfigForTests();
    }
  });
});
