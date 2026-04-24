import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const firebaseRules = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.rules.json'), 'utf8'));
const firebaseJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'));
const firebaserc = JSON.parse(fs.readFileSync(path.join(repoRoot, '.firebaserc'), 'utf8'));

describe('firebase project configuration', () => {
  it('keeps the production Firebase web config wired in index.html', () => {
    const snippet = indexHtml.match(/const firebaseConfig = \{[\s\S]*?\n  \};/);
    expect(snippet && snippet[0]).toContain('apiKey: "AIzaSyBn4jWkZMOKNyxRw2zUISY8xG4CvMEvyVY"');
    expect(snippet && snippet[0]).toContain('authDomain: "miniswettapp.firebaseapp.com"');
    expect(snippet && snippet[0]).toContain('projectId: "miniswettapp"');
    expect(snippet && snippet[0]).toContain('databaseURL: "https://miniswettapp-default-rtdb.europe-west1.firebasedatabase.app/"');
    expect(snippet && snippet[0]).toContain('storageBucket: "miniswettapp.firebasestorage.app"');
    expect(snippet && snippet[0]).toContain('messagingSenderId: "418982681815"');
    expect(snippet && snippet[0]).toContain('appId: "1:418982681815:web:2fa96d0bc47d5b3df16492"');
  });

  it('points Firebase CLI deployment at the miniswettapp database rules', () => {
    expect(firebaserc.projects.default).toBe('miniswettapp');
    expect(firebaseJson.database.rules).toBe('firebase.rules.json');
  });
});

describe('firebase realtime database rules', () => {
  const { rules } = firebaseRules;

  it('does not allow a generic authenticated stats write', () => {
    const statsWrite = rules.stats.$uid['.write'];
    expect(statsWrite).not.toBe('auth != null');
    expect(statsWrite).toContain('auth.uid == $uid');
    expect(statsWrite).toContain("role').val() == 'admin'");
    expect(statsWrite).toContain("role').val() == 'dev'");
  });

  it('keeps role elevation restricted to devs after initial self-profile creation', () => {
    const roleWrite = rules.users.$uid.role['.write'];
    expect(roleWrite).toContain("role').val() == 'dev'");
    expect(roleWrite).toContain("newData.val() == 'user'");
    expect(roleWrite).not.toContain("newData.val() == 'admin'");
  });

  it('rejects unknown children in user, service, attendee, chat and stats records', () => {
    expect(rules.users.$uid.$other['.validate']).toBe(false);
    expect(rules.services.$sid.$other['.validate']).toBe(false);
    expect(rules.services.$sid.attendees.$uid.$other['.validate']).toBe(false);
    expect(rules.chat.$mid.$other['.validate']).toBe(false);
    expect(rules.stats.$uid.$other['.validate']).toBe(false);
  });

  it('requires complete attendee records under services', () => {
    expect(rules.services.$sid.attendees.$uid['.validate']).toContain('uid');
    expect(rules.services.$sid.attendees.$uid['.validate']).toContain('username');
    expect(rules.services.$sid.attendees.$uid['.validate']).toContain('displayName');
    expect(rules.services.$sid.attendees.$uid['.validate']).toContain('ts');
  });

  it('allows system chat messages only from admin or dev users and keeps them attributable', () => {
    const chatWrite = rules.chat.$mid['.write'];
    expect(chatWrite).toContain("newData.child('system').val() == true");
    expect(chatWrite).toContain("newData.child('uid').val() == '__system__'");
    expect(chatWrite).toContain("newData.child('triggeredBy').val() == auth.uid");
    expect(chatWrite).toContain("role').val() == 'admin'");
    expect(chatWrite).toContain("role').val() == 'dev'");
  });
});
