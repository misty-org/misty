// Saved sign-ins: ask for the menu, fill and capture. Runs in the same
// initialization closure as the context menu (sendHostNavigation, encode,
// shortcutToken), in the top-level page only. This is the page's own JavaScript
// world, so anything here can be hooked or called by the page. It therefore draws
// nothing and can't ask for a sign-in: Misty's own interface shows the saved
// sign-ins, and only a click there fills one. A page learns nothing before that.
(() => {
  if (window.top !== window) return;
  // Captured before page scripts run, so a page cannot intercept fills here.
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  // Built by concatenation with the captured `encode` only: page scripts may
  // replace prototype methods later and must never see the token.
  const send = (action, extra) => {
    sendHostNavigation('misty-passwords:' + action + '?token=' + encode(shortcutToken) + extra);
  };
  const visible = (el) =>
    Boolean(el && el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const textLike = (input) => /^(text|email|tel|)$/i.test(input.getAttribute('type') || 'text');
  const passwordIn = (scope) =>
    [...(scope || document).querySelectorAll('input[type="password"]')].find(visible) || null;
  // The text field just before the password field, the way sign-in forms are laid out.
  const usernameFor = (password) => {
    const inputs = [...(password.form || document).querySelectorAll('input')].filter(
      (input) => input !== password && textLike(input) && visible(input),
    );
    let before = null;
    for (const input of inputs)
      if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) before = input;
    return before || inputs.find((input) => /user|email|login/i.test(input.name + input.id + input.autocomplete)) || null;
  };
  const setValue = (input, value) => {
    if (valueSetter) valueSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let target = null;
  let hideTimer = 0;
  let filledAt = -Infinity;
  let asked = false;
  const hide = () => {
    if (!asked) return;
    asked = false;
    send('hide', '');
  };
  // Fractions of the page, so the menu lands under the field at any zoom. A page can
  // lie about these; Misty keeps the menu inside the page and ignores early clicks.
  const place = (field) => {
    const box = field.getBoundingClientRect();
    const fraction = (value, size) => encode('' + value / (size || 1));
    return '&left=' + fraction(box.left, innerWidth) + '&bottom=' + fraction(box.bottom, innerHeight) +
      '&width=' + fraction(box.width, innerWidth);
  };

  Object.defineProperty(window, '__MISTY_PASSWORDS__', {
    value: Object.freeze({
      fill(username, password) {
        const field = target?.type === 'password' ? target : target && passwordIn(target.form || document);
        if (!field || typeof password !== 'string') return;
        const user = usernameFor(field);
        if (user && typeof username === 'string' && username) setValue(user, username);
        setValue(field, password);
        // The click moved focus to Misty. Coming back must not reopen the menu.
        filledAt = performance.now();
        field.focus();
      },
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  document.addEventListener('focusin', (event) => {
    const field = event.target;
    if (!event.isTrusted || !(field instanceof HTMLInputElement)) return;
    const password = field.type === 'password' ? field : passwordIn(field.form || document);
    if (!password || (field !== password && usernameFor(password) !== field)) return;
    clearTimeout(hideTimer);
    target = field;
    if (performance.now() - filledAt < 1000) return;
    asked = true;
    send('list', place(field));
  }, true);
  document.addEventListener('focusout', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  }, true);
  window.addEventListener('pagehide', hide, true);

  // A submitted sign-in goes to Misty, which asks before saving it.
  let lastCaptured = '';
  const capture = (scope) => {
    const password = passwordIn(scope || document);
    if (!password || !password.value) return;
    const user = usernameFor(password);
    const key = (user?.value || '') + '\n' + password.value;
    if (key === lastCaptured) return;
    lastCaptured = key;
    send(
      'capture',
      '&username=' + encode(('' + (user?.value || '')).slice(0, 512)) +
        '&password=' + encode(('' + password.value).slice(0, 4096)),
    );
  };
  document.addEventListener('submit', (event) => {
    if (event.isTrusted && event.target instanceof HTMLFormElement) capture(event.target);
  }, true);
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('button, input[type="submit"]');
    if (button && button.type === 'submit' && passwordIn(button.form || document)) capture(button.form);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.isTrusted && event.key === 'Enter' && event.target instanceof HTMLInputElement &&
        passwordIn(event.target.form || document)) capture(event.target.form);
  }, true);
})();
