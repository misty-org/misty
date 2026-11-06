// Saved addresses and cards: the chip, filling and capture. Runs in the same initialization closure
// as the context menu (sendHostNavigation, encode, shortcutToken), in the top-level page only.
// Everything drawn here is in the site's reach, so no saved detail is ever sent here until the person
// has picked it in Misty's own interface. The chip only says what kind of thing can be filled.
(() => {
  if (window.top !== window) return;
  // Captured before page scripts run, so a page can't intercept fills here.
  const setters = {
    INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set,
    TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set,
    SELECT: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set,
  };
  const showPopover = HTMLElement.prototype.showPopover;
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
  let chip = null;
  const closeChip = () => {
    chip?.remove();
    chip = null;
  };
  const showChip = (field, kind) => {
    closeChip();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const rect = field.getBoundingClientRect();
    host.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;left:' + Math.round(rect.left) + 'px;top:' +
      Math.round(rect.bottom + 4) + 'px';
    const row = document.createElement('button');
    row.type = 'button';
    row.textContent = kind === 'card' ? 'Fill card' : 'Fill address';
    row.setAttribute('style',
      'display:block;padding:6px 12px;border:1px solid #3a3a3c;border-radius:8px;background:#1c1c1e;' +
      'color:#f2f2f2;font:13px -apple-system,system-ui,sans-serif;cursor:pointer;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35)');
    row.addEventListener('mouseenter', () => { row.style.background = '#3a3a3c'; });
    row.addEventListener('mouseleave', () => { row.style.background = '#1c1c1e'; });
    // Keep focus in the field so the fill lands where the person was typing.
    row.addEventListener('mousedown', (event) => event.preventDefault());
    const shownAt = performance.now();
    row.addEventListener('click', (event) => {
      // A chip that appears under a click meant for the page isn't a choice.
      if (!event.isTrusted || performance.now() - shownAt < 300) return;
      const box = field.getBoundingClientRect();
      closeChip();
      send(
        'choose',
        '&kind=' + kind +
          '&x=' + encode('' + box.left / Math.max(window.innerWidth, 1)) +
          '&y=' + encode('' + (box.bottom + 4) / Math.max(window.innerHeight, 1)),
      );
    });
    shadow.append(row);
    // In the top layer, so a site's modal dialog can't cover it. A modal makes everything outside
    // it unclickable, so the chip goes inside the field's dialog.
    host.setAttribute('popover', 'manual');
    (field.closest('dialog') || document.documentElement).append(host);
    showPopover?.call(host);
    chip = host;
  };

  Object.defineProperty(window, '__MISTY_AUTOFILL__', {
    value: Object.freeze({
      offer(kind) {
        if (!target || kind !== targetKind || target.getRootNode().activeElement !== target) return;
        showChip(target, kind);
      },
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
    target = element;
    targetKind = kind;
    send('focus', '&kind=' + kind);
  }, true);
  document.addEventListener('focusout', () => setTimeout(closeChip, 150), true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeChip();
  }, true);

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
