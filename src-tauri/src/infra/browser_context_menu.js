// Runs in the initialization closure; the gesture token is never published on window.
let contextDocumentRevision = 0;
const contextSemanticSnapshot = (__MISTY_CONTEXT_SEMANTIC_PLACEHOLDER__);
new MutationObserver(() => { contextDocumentRevision += 1; }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
document.addEventListener('contextmenu', event => {
  if (!event.isTrusted) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  const editable = target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
  const sensitive = editable?.matches('input[type="password"]');
  const fieldSelection = editable && typeof editable.selectionStart === 'number'
    ? editable.value.slice(editable.selectionStart, editable.selectionEnd) : '';
  const selection = sensitive ? '' : (fieldSelection || String(window.getSelection() || '')).slice(0, 16000);
  const link = target.closest('a[href]');
  const image = target.closest('img[src]');
  const content = sensitive ? '' : selection || (target.closest('[data-message-id],[data-legacy-message-id]')?.innerText || target.innerText || '').slice(0, 16000);
  const safeURL = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : ''; } catch { return ''; } };
  const payload = {
    url: location.href.slice(0, 2048), title: document.title.slice(0, 200),
    documentRevision: `${performance.timeOrigin}:${contextDocumentRevision}`,
    content, selection: Boolean(selection), editable: Boolean(editable),
    link: link ? safeURL(link.href) : '', image: image ? safeURL(image.currentSrc || image.src) : '',
    mail: null,
  };
  // Provider facts remain untrusted content. They can only narrow a host-owned
  // capability receipt; they cannot create permissions or approve an effect.
  if (!sensitive && !editable && target.closest('[data-message-id],[data-legacy-message-id]')) {
    try {
      const observed = contextSemanticSnapshot();
      if (observed?.thread === location.href && observed.account && observed.message) {
        payload.mail = { account: observed.account.slice(0, 320), threadReference: observed.thread.slice(0, 2048) };
      }
    } catch { /* Ordinary browser commands remain available. */ }
  }
  const params = new URLSearchParams({ token: shortcutToken, payload: JSON.stringify(payload) });
  window.location.href = `misty-context-menu:open?${params}`;
}, true);
