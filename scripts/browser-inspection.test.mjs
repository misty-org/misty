import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = (name) => readFileSync(new URL(`../src-tauri/src/infra/browser_inspection_${name}.js`, import.meta.url), 'utf8');
function page(html) {
  const dom = new JSDOM(html, { url: 'https://example.com', runScripts: 'outside-only' });
  return {
    document: dom.window.document,
    inspect: (nonce = 'first', text = 10000, count = 500) => dom.window.eval(`(${source('snapshot')})`)(nonce, text, count),
    click: (target) => dom.window.eval(`(${source('click')})`)(target),
    close: () => dom.window.close(),
  };
}

test('DOM insertion and reordering still click the exact inspected node', () => {
  const p = page('<main><button>Original</button></main>');
  try {
    const original = p.document.querySelector('button');
    let clicked = 0;
    original.addEventListener('click', () => clicked++);
    const { target } = p.inspect().interactive[0];
    original.insertAdjacentHTML('beforebegin', '<button>Inserted</button>');
    p.document.querySelector('main').append(original);
    assert.equal(p.click(target).ok, true);
    assert.equal(clicked, 1);
  } finally { p.close(); }
});

test('replaced or changed controls require a new inspection', () => {
  for (const change of [
    (element) => { element.outerHTML = element.outerHTML; },
    (element) => { element.textContent = 'Different action'; },
    (element) => { element.href = '/different'; },
    (element) => { element.closest('li').firstChild.textContent = 'Different account '; },
    (element) => { element.setAttribute('aria-label', 'Different action'); },
  ]) {
    const p = page('<li>Account one <a href="/original">Open</a></li>');
    try {
      const { target } = p.inspect().interactive[0];
      change(p.document.querySelector('a'));
      assert.equal(p.click(target).ok, false);
    } finally { p.close(); }
  }
});

test('new snapshots and new documents invalidate old targets', () => {
  const p = page('<button>Original</button>');
  const other = page('<button>Original</button>');
  try {
    const { target } = p.inspect().interactive[0];
    p.inspect('second');
    assert.equal(p.click(target).ok, false);
    assert.equal(other.click(target).ok, false);
  } finally { p.close(); other.close(); }
});

test('inspection bounds output and excludes hidden/password inputs even with roles', () => {
  const p = page('<p>Long page content</p><input type="password" tabindex="0" role="button" value="secret"><input type="hidden" role="button" value="secret"><input value="private"><button>One</button><button>Two</button>');
  try {
    const snapshot = p.inspect('first', 4, 2);
    assert.equal(snapshot.text.length, 4);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.interactive.length, 2);
    assert.equal(snapshot.interactive[0].name, '');
    assert.doesNotMatch(JSON.stringify(snapshot), /secret|private/);
  } finally { p.close(); }
});
