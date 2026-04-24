import { describe, expect, it } from 'vitest';
import cloud from '../../api/_lib/cloud.ts';

const {
  assertReadAllowed,
  assertWriteAllowed,
  configurationStatus,
  configuredOAuthProviders,
  defaultRootState,
  getRootState,
  pathGet,
  pathSet,
  validateProvider
} = cloud;

describe('cloud API authorization helpers', () => {
  it('updates nested JSON paths immutably', () => {
    const root = { services: {} };
    const next = pathSet(root, '/services/s1/title', 'Messe');
    expect(root.services.s1).toBeUndefined();
    expect(pathGet(next, '/services/s1/title')).toBe('Messe');
  });

  it('keeps root reads restricted to dev', () => {
    expect(() => assertReadAllowed('/', 'u1', 'user')).toThrow();
    expect(() => assertReadAllowed('/', 'u1', 'dev')).not.toThrow();
  });

  it('allows users to read only their private profile while shared data stays readable', () => {
    expect(() => assertReadAllowed('/users/u1', 'u1', 'user')).not.toThrow();
    expect(() => assertReadAllowed('/users/u2', 'u1', 'user')).toThrow();
    expect(() => assertReadAllowed('/services', 'u1', 'user')).not.toThrow();
    expect(() => assertReadAllowed('/chat', 'u1', 'user')).not.toThrow();
  });

  it('enforces role-aware writes for planning and attendance', () => {
    expect(() => assertWriteAllowed('/services/s1/title', 'u1', 'user', 'X')).toThrow();
    expect(() => assertWriteAllowed('/services/s1/title', 'u1', 'admin', 'X')).not.toThrow();
    expect(() => assertWriteAllowed('/services/s1/attendees/u1', 'u1', 'user', { uid: 'u1' })).not.toThrow();
    expect(() => assertWriteAllowed('/services/s1/attendees/u2', 'u1', 'user', { uid: 'u2' })).toThrow();
  });

  it('only accepts configured OAuth providers', () => {
    expect(() => validateProvider('google')).not.toThrow();
    expect(() => validateProvider('github')).not.toThrow();
    expect(() => validateProvider('azure')).not.toThrow();
    expect(() => validateProvider('apple')).not.toThrow();
    expect(() => validateProvider('unknown')).toThrow();
  });

  it('defaults to free OAuth providers and makes Apple explicit opt-in', () => {
    const previous = process.env.APP_OAUTH_PROVIDERS;
    try {
      delete process.env.APP_OAUTH_PROVIDERS;
      expect(configuredOAuthProviders()).toEqual(['google', 'github', 'azure']);
      process.env.APP_OAUTH_PROVIDERS = 'google,github,azure,apple';
      expect(configuredOAuthProviders()).toEqual(['google', 'github', 'azure', 'apple']);
    } finally {
      if (previous == null) delete process.env.APP_OAUTH_PROVIDERS;
      else process.env.APP_OAUTH_PROVIDERS = previous;
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
      expect(configurationStatus()).toMatchObject({
        configured: false,
        missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

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
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), method: options && options.method });
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      };
      await expect(getRootState()).resolves.toEqual(defaultRootState());
      expect(calls).toHaveLength(5);
      expect(calls.every(call => call.method === 'GET')).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
