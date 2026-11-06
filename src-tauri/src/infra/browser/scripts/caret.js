// Report where the focused text field is, so the system's AutoFill suggestions open under it.
// Only a rectangle in page pixels is sent; never the field's value.
if (window === window.top) {
  let caretTimer = 0;
  let lastCaret = '';
  const reportCaret = () => {
    caretTimer = 0;
    const field = document.activeElement;
    const editable = field && field !== document.body && (
      field.isContentEditable ||
      (field instanceof HTMLTextAreaElement) ||
      (field instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color', 'image', 'reset'].includes(field.type))
    );
    let body = 'null';
    if (editable) {
      const box = field.getBoundingClientRect();
      const n = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
      body = '{"x":' + n(box.left) + ',"y":' + n(box.top) + ',"w":' + n(box.width) + ',"h":' + n(box.height) + '}';
    }
    if (body === lastCaret) return;
    // Built by concatenation: a page-defined toJSON must never see the token.
    if (sendToHost('{"token":"' + shortcutToken + '","caret":' + body + '}')) lastCaret = body;
  };
  const scheduleCaret = () => {
    if (caretTimer) return;
    caretTimer = setTimeout(reportCaret, 60);
  };
  for (const type of ['focusin', 'focusout', 'input', 'resize'])
    addEventListener(type, scheduleCaret, true);
  addEventListener('scroll', scheduleCaret, { passive: true, capture: true });
  scheduleCaret();
}
