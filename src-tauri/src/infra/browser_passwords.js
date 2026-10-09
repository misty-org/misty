// Saved sign-ins: offer, fill and capture. Runs in the same initialization
// closure as the context menu (sendHostNavigation, encode, shortcutToken), in
// the top-level page only. Misty checks the page's real address before it
// sends any sign-in, and asks before saving one.
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
  let menu = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  const showMenu = (field, entries) => {
    closeMenu();
    if (!entries.length || document.activeElement !== field) return;
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const rect = field.getBoundingClientRect();
    host.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;left:' + Math.round(rect.left) + 'px;top:' +
      Math.round(rect.bottom + 4) + 'px;min-width:' + Math.round(Math.max(rect.width, 220)) + 'px';
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    list.setAttribute('style',
      'font:13px -apple-system,system-ui,sans-serif;background:#1c1c1e;color:#f2f2f2;border:1px solid #3a3a3c;' +
      'border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.35)');
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.textContent = entry.username || 'Saved password';
      row.setAttribute('style',
        'display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;' +
        'background:transparent;color:inherit;font:inherit;cursor:pointer');
      row.addEventListener('mouseenter', () => { row.style.background = '#3a3a3c'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      // Keep focus in the field so the fill lands where the person was typing.
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        closeMenu();
        send('fill', '&id=' + encode('' + entry.id));
      });
      list.append(row);
    }
    const note = document.createElement('div');
    note.textContent = 'Saved in Misty';
    note.setAttribute('style', 'padding:4px 8px 2px;color:#8e8e93;font-size:11px');
    list.append(note);
    shadow.append(list);
    document.documentElement.append(host);
    menu = host;
  };

  Object.defineProperty(window, '__MISTY_PASSWORDS__', {
    value: Object.freeze({
      offer(entries) {
        if (!target || !Array.isArray(entries)) return;
        showMenu(target, entries.filter((entry) => entry && typeof entry.id === 'string').slice(0, 20));
      },
      fill(username, password) {
        const field = target?.type === 'password' ? target : target && passwordIn(target.form || document);
        if (!field || typeof password !== 'string') return;
        const user = usernameFor(field);
        if (user && typeof username === 'string' && username) setValue(user, username);
        setValue(field, password);
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
    target = field;
    send('list', '');
  }, true);
  document.addEventListener('focusout', () => setTimeout(closeMenu, 150), true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  }, true);

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
