// Runs in the initialization closure; the gesture token is never published on window.
let contextDocumentRevision = 0;
new MutationObserver(() => { contextDocumentRevision += 1; }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
document.addEventListener('contextmenu', event => {
  if (!event.isTrusted) return;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  const editable = target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
  // Fields keep WebKit's own menu so AutoFill, passwords, and spelling suggestions still work.
  if (editable) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const sensitive = editable?.matches('input[type="password"]');
  const fieldSelection = editable && typeof editable.selectionStart === 'number'
    ? editable.value.slice(editable.selectionStart, editable.selectionEnd) : '';
  const selection = sensitive ? '' : (fieldSelection || String(window.getSelection() || '')).slice(0, 16000);
  const link = target.closest('a[href]');
  const image = target.closest('img[src]');
  const content = sensitive ? '' : selection || (target.innerText || '').slice(0, 16000);
  const safeURL = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : ''; } catch { return ''; } };
  const payload = {
    url: location.href.slice(0, 2048), title: document.title.slice(0, 200),
    documentRevision: `${performance.timeOrigin}:${contextDocumentRevision}`,
    content, selection: Boolean(selection), editable: Boolean(editable),
    link: link ? safeURL(link.href) : '', image: image ? safeURL(image.currentSrc || image.src) : '',
  };
  // The page's own data may pass through its hooks; the token never does.
  const json = stringify(payload);
  if (typeof json !== 'string') return;
  sendHostNavigation('misty-context-menu:open?token=' + encode(shortcutToken) + '&payload=' + encode(json));
}, true);
