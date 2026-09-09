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

test('draft preparation retains text without submitting and rejects replaced/password controls', () => {
  const dom = new JSDOM('<form><textarea aria-label="Reply"></textarea><button type="submit">Send</button></form>', { url: 'https://example.com', runScripts: 'outside-only' });
  try {
    const inspect = () => dom.window.eval(`(${source('snapshot')})`)('draft', 10000, 500);
    const type = (target, text) => dom.window.eval(`(${source('type')})`)(target, text);
    let submitted = 0;
    dom.window.document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submitted++; });
    const target = inspect().interactive.find(item => item.name === 'Reply').target;
    assert.equal(type(target, 'A prepared reply').prepared, true);
    assert.equal(dom.window.document.querySelector('textarea').value, 'A prepared reply');
    assert.equal(submitted, 0);
    dom.window.document.querySelector('textarea').outerHTML = '<textarea aria-label="Reply"></textarea>';
    assert.equal(type(target, 'Wrong control').ok, false);
    dom.window.document.body.innerHTML = '<input type="text" aria-label="Name">';
    const passwordTarget = inspect().interactive[0].target;
    dom.window.document.querySelector('input').type = 'password';
    assert.equal(type(passwordTarget, 'Never fill credentials').ok, false);
  } finally { dom.window.close(); }
});

test('provider GET requests reject origin escapes and bound output without returning response headers', async () => {
  const body = readFileSync(new URL('../src-tauri/src/infra/browser_provider_request.js', import.meta.url), 'utf8');
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('origin', 'path', 'location', 'fetch', body);
  const location = { origin: 'https://www.instagram.com', href: 'https://www.instagram.com/direct/inbox/' };
  let options;
  const request = async (_url, input) => { options = input; return new Response('x'.repeat(300000), { status: 200, headers: { 'x-sensitive': 'do-not-return' } }); };
  const result = JSON.parse(await run(location.origin, '/api/fixture', location, request));
  assert.equal(result.truncated, true);
  assert.equal(result.body.length, 262144);
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
  for (const path of ['//evil.test/data', '/\\evil.test/data', 'https://evil.test/data']) await assert.rejects(run(location.origin, path, location, request));
  await assert.rejects(run('https://other.instagram.com', '/api', location, request));
});

test('bounded interactions require the exact unconsumed document and retain selection', () => {
  const dom = new JSDOM('<select aria-label="Folder"><option value="inbox">Inbox</option><option value="archive">Archive</option></select>', { url: 'https://example.com', runScripts: 'outside-only' });
  try {
    const inspect = nonce => dom.window.eval(`(${source('snapshot')})`)(nonce,10000,500);
    const interact = (target,action,documentId) => dom.window.eval(`(${source('interact')})`)(target,action,'https://example.com',documentId);
    const target=inspect('new-document').interactive[0].target;
    const action={kind:'select',values:['archive']};
    assert.equal(interact(target,action,'old-document').ok,false);
    assert.equal(dom.window.document.querySelector('select').value,'inbox');
    assert.equal(interact(target,action,'new-document').attempted,true);
    assert.equal(dom.window.document.querySelector('select').value,'archive');
    assert.equal(interact(target,action,'new-document').ok,false);
    inspect('another-document');
    assert.equal(interact(null,{kind:'scroll',x:0,y:1},'new-document').ok,false);
  } finally {dom.window.close();}
});

test('inspection reports partial coverage when only the element list is truncated', () => {
  const p=page('<button>One</button><button>Two</button>');
  try {assert.equal(p.inspect('elements',10000,1).truncated,true);} finally {p.close();}
});
