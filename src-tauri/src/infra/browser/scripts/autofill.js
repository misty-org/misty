// Saved addresses and cards: filling and capture. Runs in the same initialization closure as the
// context menu (sendHostNavigation, encode, shortcutToken), in the top-level page only. This is the
// page's own JavaScript world, so anything here can be hooked or called by the page. It therefore
// draws nothing and can't open the list of saved details. It only says a form has focus and where;
// Misty draws the chip, and nothing tells the page whether anything is saved.
(() => {
  if (window.top !== window) return;
  // Captured before page scripts run, so a page can't intercept fills here.
  const setters = {
    INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set,
    TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set,
    SELECT: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set,
  };
  const fields = autofillFields;
  const send = (action, extra) => {
    sendHostNavigation('misty-autofill:' + action + '?token=' + encode(shortcutToken) + extra);
  };

  const labelOf = (element) => {
    const labelled = element.getAttribute('aria-labelledby');
    const named = labelled && element.getRootNode().getElementById?.(labelled);
    return [...(element.labels || [])].map((label) => label.textContent).join(' ') || named?.textContent || '';
  };
  const describe = (element) => ({
    tag: element.tagName,
    type: element.getAttribute('type') || '',
    autocomplete: element.getAttribute('autocomplete') || '',
    name: element.getAttribute('name') || '',
    id: element.id || '',
    label: labelOf(element),
    placeholder: element.getAttribute('placeholder') || '',
    ariaLabel: element.getAttribute('aria-label') || '',
    maxLength: element.maxLength,
  });
  // A site can hide fields to collect more than the person sees, so only what's really on the page
  // counts: never hidden, invisible, tiny or pushed off the page. Styled dropdowns often lay a
  // transparent native select over their own, so opacity doesn't count against a select.
  const onPage = (element) => {
    if (!element.isConnected || element.disabled || element.readOnly) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.right + window.scrollX <= 0 || rect.bottom + window.scrollY <= 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none') return false;
    if (element.tagName === 'SELECT') return true;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      if (parseFloat(getComputedStyle(node).opacity) < 0.1) return false;
    }
    return true;
  };
  const scopeOf = (element) => element.form || element.getRootNode();
  const fieldsIn = (scope) =>
    [...scope.querySelectorAll('input,select,textarea')].flatMap((element) => {
      if (!onPage(element)) return [];
      const meta = describe(element);
      const type = fields.classifyField(meta);
      return type ? [{ element, meta, type, section: fields.sectionOf(meta.autocomplete) }] : [];
    });
  const setValue = (element, value) => {
    const setter = setters[element.tagName];
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const write = (field, value) => {
    if (field.element.tagName !== 'SELECT') {
      setValue(field.element, value);
      return;
    }
    const options = [...field.element.options];
    const index = fields.matchOption(
      field.type,
      value,
      options.map((option) => ({ value: option.value, text: option.text })),
    );
    if (index >= 0) setValue(field.element, options[index].value);
  };

  let target = null;
  let targetKind = '';
  let closeTimer = 0;
  let asked = false;
  const hide = () => {
    if (!asked) return;
    asked = false;
    send('hide', '');
  };
  // Fractions of the page, so the chip lands under the field at any zoom. A page can lie about
  // these; Misty keeps the chip inside the page and ignores early clicks.
  const place = (field) => {
    const box = field.getBoundingClientRect();
    const fraction = (value, size) => encode('' + value / (size || 1));
    return '&left=' + fraction(box.left, innerWidth) + '&bottom=' + fraction(box.bottom, innerHeight);
  };

  Object.defineProperty(window, '__MISTY_AUTOFILL__', {
    value: Object.freeze({
      fill(kind, values) {
        if (!target || kind !== targetKind || !target.isConnected) return;
        const all = fieldsIn(scopeOf(target));
        const focus = all.findIndex((field) => field.element === target);
        if (focus < 0) return;
        for (const index of fields.planFill(all, focus)) {
          const field = all[index];
          // Never overwrite what's already there, except in the field the person chose to fill.
          if (field.element !== target && field.element.value) continue;
          const value = fields.valueFor(field.type, values, field.meta);
          if (value) write(field, value);
        }
      },
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  document.addEventListener('focusin', (event) => {
    const element = event.composedPath()[0];
    if (!event.isTrusted || !(element instanceof Element)) return;
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || !onPage(element)) return;
    const type = fields.classifyField(describe(element));
    if (!type) return;
    const kind = fields.kindOf(type);
    if (!fields.formIsFor(kind, fieldsIn(scopeOf(element)).map((field) => field.type))) return;
    clearTimeout(closeTimer);
    target = element;
    targetKind = kind;
    asked = true;
    send('focus', '&kind=' + kind + place(element));
  }, true);
  document.addEventListener('focusout', () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(hide, 150);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  }, true);
  window.addEventListener('pagehide', hide, true);

  // A submitted address or card goes to Misty, which asks before saving it. Security codes are
  // never classified as anything, so they're never read.
  let lastCaptured = '';
  const capture = (scope) => {
    const entries = fieldsIn(scope || document).map((field) => {
      const select = field.element.tagName === 'SELECT';
      return [field.type, select ? field.element.selectedOptions[0]?.text || '' : field.element.value];
    });
    const form = fields.readForm(entries);
    if (!form.address && !form.card) return;
    const data = JSON.stringify(form);
    if (data === lastCaptured) return;
    lastCaptured = data;
    send('capture', '&data=' + encode(data));
  };
  document.addEventListener('submit', (event) => {
    if (event.isTrusted && event.target instanceof HTMLFormElement) capture(event.target);
  }, true);
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('button, input[type="submit"]');
    if (button && button.type === 'submit') capture(button.form);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.isTrusted && event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      capture(event.target.form);
    }
  }, true);
})();
