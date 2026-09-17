import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src-tauri/src/infra/browser_scripts.rs', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  const handleLinkClick ='), source.indexOf("  document.addEventListener('pointerover'"));

function click(overrides = {}, target = '_blank', href = '/channels/server/thread') {
  const opened = [];
  const listeners = {};
  runInNewContext(handler, {
    URL,
    window: { location: { href: 'https://discord.com/channels/server/channel' }, open: (...args) => opened.push(args) },
    document: { addEventListener: (name, callback, capture) => { assert.ok(!capture); listeners[name] = callback; } },
  });
  const event = {
    isTrusted: true, type: 'click', button: 0,
    target: { closest: () => ({ getAttribute: (name) => name === 'href' ? href : target }) },
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() {},
    ...overrides,
  };
  listeners[event.type](event);
  return { opened, event };
}

test('ordinary channel links remain owned by the site, including named targets', () => {
  for (const target of ['', '_blank', '_new', 'channel']) for (const href of ['/channels/server/thread', 'https://accounts.google.com/AccountChooser/signinchooser', 'https://outside-provider.example/']) {
    const result = click({}, target, href);
    assert.deepEqual(result.opened, []);
    assert.ok(!result.event.defaultPrevented);
  }
});
test('site-cancelled and synthetic clicks never open extra windows', () => {
  assert.deepEqual(click({ metaKey: true, defaultPrevented: true }).opened, []);
  assert.deepEqual(click({ metaKey: true, isTrusted: false }).opened, []);
});
test('explicit new-tab gestures still work', () => {
  for (const gesture of [{ metaKey: true }, { ctrlKey: true }, { type: 'auxclick', button: 1 }]) {
    assert.deepEqual(click(gesture).opened, [['https://discord.com/channels/server/thread', '_blank']]);
  }
});

test('pointer focus reports over native messaging without navigating the page', () => {
  const start = source.indexOf("  document.addEventListener('pointerdown'");
  const end = source.indexOf('\n\n  const reportPointer', start);
  let pointer;
  const messages = [];
  const window = { webkit: { messageHandlers: { mistyFocus: { postMessage: token => messages.push(token) } } } };
  Object.defineProperty(window, 'location', { get() { throw new Error('Focus must not touch page navigation'); } });
  runInNewContext(source.slice(start, end), { shortcutToken: 'test-token', window, document: { addEventListener: (_, fn) => { pointer = fn; } } });
  pointer({ isTrusted: true });
  pointer({ isTrusted: false });
  assert.deepEqual(messages, ['test-token']);
});

test('companion pointer tracking reports over native messaging without interrupting navigation', () => {
  const script = source.match(/const BROWSER_VIEWPORT_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1]
    .replace('__MISTY_CONTEXT_MENU_PLACEHOLDER__', '')
    .replace('__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__', '"test-token"')
    .replace('__MISTY_POINTER_TRACKING_PLACEHOLDER__', 'true');
  const listeners = {};
  const frames = [];
  const messages = [];
  const window = {
    innerWidth: 800, innerHeight: 600,
    webkit: { messageHandlers: { mistyFocus: { postMessage: body => messages.push(JSON.parse(body)) } } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  Object.defineProperty(window, 'location', { get() { throw new Error('Pointer tracking must not navigate'); } });
  runInNewContext(script, {
    window, Map, URL, URLSearchParams,
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    performance: { now: () => 100 },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
  });
  listeners.pointermove({ isTrusted: true, clientX: 12.34, clientY: 45.67 });
  frames.shift()();
  listeners.pointerout({ relatedTarget: null });
  assert.deepEqual(messages, [
    { token: 'test-token', pointer: { x: 12.3, y: 45.7, inside: true } },
    { token: 'test-token', pointer: { x: 0, y: 0, inside: false } },
  ]);
  window.__MISTY_SET_POINTER_TRACKING__(false);
  listeners.pointermove({ isTrusted: true, clientX: 10, clientY: 10 });
  listeners.blur();
  assert.equal(frames.length, 0);
  assert.equal(messages.length, 2);
});
