import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(repoRoot, 'sw.js'), 'utf8');

describe('browser security metadata', () => {
  const csp = indexHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

  it('does not use frame-ancestors in a meta CSP', () => {
    expect(csp).not.toContain('frame-ancestors');
  });

  it('allows Firebase SDK sourcemap requests without weakening script-src', () => {
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://www.gstatic.com');
    expect(csp).toContain("script-src 'self'");
  });

  it('pins Font Awesome to the digest served by cdnjs', () => {
    expect(indexHtml).toContain('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css');
    expect(indexHtml).toContain('sha512-SnH5WK+bZxgPHs44uWIX+LLJAJ9/2PkPKZ5QiAj6Ta86w+fsb2TkcmfRyVX3pBnMFcV7oQPJkl9QevSCWr3W6A==');
  });

  it('service workers ignore unsupported request schemes before cache.put', () => {
    expect(sw).toContain("url.protocol !== 'http:' && url.protocol !== 'https:'");
    expect(indexHtml).toContain("url.protocol !== 'http:' && url.protocol !== 'https:'");
    expect(sw.indexOf('url.protocol')).toBeLessThan(sw.indexOf('cache.put'));
  });
});
