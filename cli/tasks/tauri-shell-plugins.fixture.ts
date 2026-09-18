// Invoked by the shell_plugins Rust test with the installed plugins' exact scripts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const { windows, ...scripts } = JSON.parse(readFileSync(0, 'utf8'));

async function page({ label, subframe = false, metadata = true, notification = true }) {
  const calls = [];
  const listeners = [];
  function NativeNotification() {}
  NativeNotification.permission = 'default';
  class Node {}
  const window = {
    Notification: notification ? NativeNotification : undefined,
    __TAURI_INTERNALS__: {
      // External tabs are children of main; the window label must not authorize them.
      ...(metadata ? { metadata: { currentWindow: { label: 'main' }, currentWebview: { label } } } : {}),
      invoke: async (command, args) => {
        calls.push({ command, args });
        return command.endsWith('is_permission_granted') ? true : undefined;
      },
    },
    addEventListener: (type, callback) => listeners.push({ type, callback }),
  };
  window.top = subframe ? {} : window;
  for (const script of Object.values(scripts)) {
    runInNewContext(script, { window, Node, URL });
  }
  await new Promise(resolve => setImmediate(resolve));

  const anchor = Object.assign(new Node(), {
    nodeName: 'A', href: 'https://accounts.google.com/signin', target: '_blank',
  });
  const event = {
    button: 0, defaultPrevented: false,
    composedPath: () => [anchor],
    preventDefault() { this.defaultPrevented = true; },
  };
  for (const listener of listeners.filter(listener => listener.type === 'click')) {
    listener.callback(event);
  }
  await new Promise(resolve => setImmediate(resolve));
  return { calls, listeners, window, NativeNotification, event };
}

for (const label of [
  'misty-browser-tab-sdk-browser-example',
  'misty-browser-tab-popup-example',
  'misty-browser-provider-inbox',
]) {
  for (const notification of [true, false]) {
    const result = await page({ label, notification });
    assert.deepEqual(result.calls, [], `${label}: no startup or click IPC`);
    assert.equal(result.listeners.length, 0, `${label}: no plugin link interception`);
    assert.equal(result.event.defaultPrevented, false, `${label}: links can navigate`);
    assert.equal(result.window.Notification, notification ? result.NativeNotification : undefined);
  }
}

for (const options of [{ label: 'main', subframe: true }, { metadata: false }]) {
  const result = await page(options);
  assert.deepEqual(result.calls, []);
  assert.equal(result.listeners.length, 0);
  assert.equal(result.window.Notification, result.NativeNotification);
}

const shell = await page({ label: 'main' });
assert.notEqual(shell.window.Notification, shell.NativeNotification);
assert.equal(shell.window.Notification.permission, windows ? 'denied' : 'granted');
assert.equal(shell.event.defaultPrevented, true);
assert.deepEqual(shell.calls.map(call => call.command), [
  ...(!windows ? ['plugin:notification|is_permission_granted'] : []),
  'plugin:opener|open_url',
]);
assert.equal(String(shell.calls.at(-1).args.url), 'https://accounts.google.com/signin');
new shell.window.Notification('Shell notification', { body: 'Still available' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(shell.calls.at(-1).command, 'plugin:notification|notify');
console.log('PASS: embedded tabs, popups, absent Notification, subframes, and shell plugin behavior');
