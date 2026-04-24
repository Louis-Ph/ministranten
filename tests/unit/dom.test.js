import { describe, it, expect, beforeAll } from 'vitest';
import { loadApp } from './helpers.js';

let T;
beforeAll(async () => { T = await loadApp(); });

describe('DOM builder h()', () => {
  it('creates elements with text via textContent (XSS-safe)', () => {
    const el = T.h('div', { text: '<script>alert(1)</script>' });
    expect(el.tagName).toBe('DIV');
    expect(el.textContent).toBe('<script>alert(1)</script>');
    expect(el.querySelector('script')).toBe(null);
  });

  it('never escapes attribute-injected malicious event handlers as real handlers', () => {
    const el = T.h('div', { 'data-payload': '" onmouseover=alert(1) x="' });
    expect(el.getAttribute('data-payload')).toContain('onmouseover=alert(1)');
    // No listener was attached (setAttribute, not property)
    expect(el.onmouseover).toBeFalsy();
  });

  it('attaches real listeners only for on* function values', () => {
    let clicked = 0;
    const el = T.h('button', { onclick: () => clicked++ }, ['Click']);
    el.click();
    expect(clicked).toBe(1);
  });

  it('supports nested arrays of children and skips null/false', () => {
    const el = T.h('ul', {}, [
      T.h('li', { text: 'a' }),
      null,
      false,
      [T.h('li', { text: 'b' }), T.h('li', { text: 'c' })]
    ]);
    expect(el.querySelectorAll('li').length).toBe(3);
    expect(el.textContent).toBe('abc');
  });

  it('respects dataset assignment', () => {
    const el = T.h('div', { dataset: { foo: 'bar' } });
    expect(el.dataset.foo).toBe('bar');
  });

  it('treats second argument as children if not a plain attrs object', () => {
    const el = T.h('p', ['hello']);
    expect(el.textContent).toBe('hello');
  });
});

describe('state / FSM', () => {
  it('starts in LOGIN view', () => {
    expect(T.state.view).toBe(T.VIEWS.LOGIN);
  });
  it('dev masterkey transitions to HOME and assigns dev role', () => {
    T.enterDevMode('miniswettapp');
    expect(T.state.user.role).toBe(T.ROLES.DEV);
    expect(T.state.view).toBe(T.VIEWS.HOME);
  });
  it('rejects wrong masterkey', () => {
    const before = T.state.user;
    T.enterDevMode('wrong');
    // user unchanged (still previous dev or null)
    expect(T.state.user).toBe(before);
  });
});

describe('roles / permissions', () => {
  it('keeps a strict user < admin < dev hierarchy', () => {
    expect(T.roleAtLeast(T.ROLES.USER, T.ROLES.USER)).toBe(true);
    expect(T.roleAtLeast(T.ROLES.USER, T.ROLES.ADMIN)).toBe(false);
    expect(T.roleAtLeast(T.ROLES.ADMIN, T.ROLES.USER)).toBe(true);
    expect(T.roleAtLeast(T.ROLES.ADMIN, T.ROLES.DEV)).toBe(false);
    expect(T.roleAtLeast(T.ROLES.DEV, T.ROLES.ADMIN)).toBe(true);
  });

  it('maps roles to visible application views', () => {
    expect(T.canAccessView(T.VIEWS.HOME, T.ROLES.USER)).toBe(true);
    expect(T.canAccessView(T.VIEWS.CHAT, T.ROLES.USER)).toBe(true);
    expect(T.canAccessView(T.VIEWS.PROFILE, T.ROLES.USER)).toBe(true);
    expect(T.canAccessView(T.VIEWS.ADMIN, T.ROLES.USER)).toBe(false);
    expect(T.canAccessView(T.VIEWS.STATS, T.ROLES.ADMIN)).toBe(true);
    expect(T.canAccessView(T.VIEWS.DEV, T.ROLES.ADMIN)).toBe(false);
    expect(T.canAccessView(T.VIEWS.DEV, T.ROLES.DEV)).toBe(true);
  });

  it('provides one local demo account per role', () => {
    expect(T.DEMO_ACCOUNTS.map(a => a.role).sort()).toEqual([
      T.ROLES.ADMIN,
      T.ROLES.DEV,
      T.ROLES.USER
    ].sort());
  });
});
