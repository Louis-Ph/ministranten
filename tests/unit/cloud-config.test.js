import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
const vercelJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
const schemaSql = fs.readFileSync(path.join(repoRoot, 'supabase/schema.sql'), 'utf8');

describe('cloud project configuration', () => {
  it('does not expose cloud service credentials in index.html', () => {
    expect(indexHtml).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(indexHtml).not.toContain('SUPABASE_PUBLISHABLE_KEY=');
    expect(indexHtml).toContain('./api/config');
    expect(indexHtml).toContain('./api/data');
  });

  it('documents all required runtime variables without secret values', () => {
    expect(envExample).toContain('SUPABASE_URL=');
    expect(envExample).toContain('SUPABASE_PUBLISHABLE_KEY=');
    expect(envExample).toContain('SUPABASE_SERVICE_ROLE_KEY=');
    expect(envExample).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=$/m);
    expect(envExample).toContain('APP_BASE_URL=');
    expect(envExample).toContain('APP_OAUTH_PROVIDERS=google,github,azure');
  });

  it('wires free OAuth providers by default and keeps Apple opt-in only', () => {
    expect(indexHtml).toContain("{ id: 'google', label: 'Google'");
    expect(indexHtml).toContain("{ id: 'github', label: 'GitHub'");
    expect(indexHtml).toContain("{ id: 'azure', label: 'Microsoft'");
    expect(indexHtml).toContain("{ id: 'apple', label: 'Apple'");
    expect(indexHtml).toContain("FREE_CLOUD_OAUTH_PROVIDER_IDS = Object.freeze(['google', 'github', 'azure'])");
    expect(indexHtml).toContain('enabledCloudOAuthProviders');
    expect(indexHtml).toContain('./api/auth/start?provider=');
    expect(indexHtml).toContain('CLOUD_OAUTH_STATE_KEY');
  });

  it('ships a Vercel configuration with security headers', () => {
    expect(vercelJson.headers[0].headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'X-Content-Type-Options', value: 'nosniff' }),
        expect.objectContaining({ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }),
        expect.objectContaining({ key: 'Permissions-Policy' })
      ])
    );
  });

  it('keeps direct table access closed behind API routes', () => {
    expect(schemaSql).toContain('create table if not exists public.app_users');
    expect(schemaSql).toContain('create table if not exists public.service_events');
    expect(schemaSql).toContain('create table if not exists public.service_attendees');
    expect(schemaSql).toContain('create table if not exists public.user_stats');
    expect(schemaSql).toContain('create table if not exists public.chat_messages');
    expect(schemaSql).toContain('alter table public.app_users enable row level security');
    expect(schemaSql).toContain('using (false)');
    expect(schemaSql).toContain('with check (false)');
    expect(schemaSql).toContain('grant select, insert, update, delete on table public.app_users to service_role');
    expect(schemaSql).toContain('grant select, insert, update, delete on table public.service_events to service_role');
    expect(schemaSql).not.toMatch(/grant\s+select.*\bto\s+anon\b/i);
  });
});
