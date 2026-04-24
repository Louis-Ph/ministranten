import { describe, expect, it } from 'vitest';
import cloud from '../../api/_lib/cloud.js';

const {
  assertReadAllowed,
  assertWriteAllowed,
  configuredOAuthProviders,
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
});
