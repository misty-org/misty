// "Add to Misty" on the Chrome Web Store and Firefox Add-ons. Runs in the same
// initialization closure as the context menu (sendHostNavigation, encode,
// shortcutToken), in the top-level page only. The message names no extension:
// Misty reads it from the tab's real address and opens its own install review,
// so the most a page can do is ask Misty to review the extension it shows.
(() => {
  if (window.top !== window) return;
  const pages = {
    'chromewebstore.google.com': /^\/detail\/(?:[^/]+\/)?[a-p]{32}(?:[/?#]|$)/,
    'addons.mozilla.org': /^\/(?:[^/]+\/)?firefox\/addon\/[^/]+/,
  };
  const page = pages[location.hostname];
  if (location.protocol !== 'https:' || !page) return;

  const chrome = location.hostname === 'chromewebstore.google.com';
  const visible = (element) => element.getClientRects().length > 0;
  // Asking people to switch browsers or download one, never the store's content.
  const getBrowser = /install chrome|switch to chrome|get chrome|download chrome/i;
  // The store's own install button, which Misty's takes the place of.
  // Remembered once found: hidden, it no longer looks like a button to find.
  let known = null;
  const storeButton = () => {
    if (known?.isConnected) return known;
    known = findStoreButton();
    return known;
  };
  const findStoreButton = () => {
    if (!chrome) return document.querySelector('.AMInstallButton, .GetFirefoxButton');
    // Text first: measuring every button on each change would force layout needlessly.
    const buttons = [...document.querySelectorAll('button')].filter(
      (button) => /chrome/i.test(button.textContent || '') && visible(button),
    );
    return (
      buttons.find((button) => /^\s*(add to|remove from) chrome\s*$/i.test(button.textContent || '')) ||
      // Other languages: the button that names Chrome without asking to install it.
      buttons.find((button) => {
        const text = button.textContent || '';
        return /chrome/i.test(text) && !getBrowser.test(text);
      }) ||
      null
    );
  };
  // "Switch to Chrome" banners: the short, wide box around a link to get the browser.
  const getsBrowser = (control) =>
    getBrowser.test(control.textContent || '') ||
    /google\.com\/chrome/.test(control.getAttribute('href') || '');
  // A notice is the smallest box holding both the "Switch to Chrome" line and its
  // link to get Chrome. Without such a link nearby, the line is left alone, so
  // page content around it is never hidden.
  const noticeAround = (element, button) => {
    let box = element;
    for (let depth = 0; depth < 5 && box && box !== document.body; depth += 1) {
      if (button && box.contains(button)) return null;
      if (box.getBoundingClientRect().height > 160) return null;
      if ([...box.querySelectorAll('a, button')].some(getsBrowser)) return box;
      box = box.parentElement;
    }
    return null;
  };
  // A prompt in a popup hides the popup, and a dialog's full-screen scrim with it
  // so no dimmed page is left. A fixed header holding a tooltip is not a scrim.
  const overlayAround = (element) => {
    let overlay = element.closest('[role="dialog"], [role="alertdialog"], [role="tooltip"]');
    if (!overlay || overlay.getAttribute('role') === 'tooltip') return overlay;
    for (let node = overlay.parentElement; node && node !== document.body; node = node.parentElement) {
      const covers = node.getBoundingClientRect().height >= window.innerHeight * 0.8;
      if (covers && getComputedStyle(node).position === 'fixed') overlay = node;
    }
    return overlay;
  };
  const switchText =
    "//text()[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'switch to chrome')]";
  // "Switch to Chrome" popups and notices on the store; nothing else on the page.
  const getBrowserBanners = (button) => {
    if (!chrome) return [...document.querySelectorAll('.GetFirefoxBanner')];
    const banners = new Set();
    const texts = document.evaluate(switchText, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let index = 0; index < texts.snapshotLength; index += 1) {
      const element = texts.snapshotItem(index).parentElement;
      if (!element || /^(SCRIPT|STYLE|NOSCRIPT|TITLE|TEMPLATE)$/.test(element.tagName)) continue;
      // Already hidden, or Misty's own button.
      if (host?.contains(element) || !visible(element)) continue;
      const box = overlayAround(element) || noticeAround(element, button);
      if (box) banners.add(box);
    }
    return banners;
  };
  const hide = (element) => {
    if (element !== host && element.style.getPropertyValue('display') !== 'none')
      element.style.setProperty('display', 'none', 'important');
  };

  let host = null;
  let pausedUntil = 0;
  let placed = '';
  const place = (style) => {
    if (placed !== style) host.style.cssText = placed = style;
  };
  const floating = 'all:initial;position:fixed;z-index:2147483647;right:24px;bottom:24px';
  const inline = 'all:initial;display:inline-block';
  // Installed state comes from Misty for the extension this page shows. The page
  // cannot replace this receiver; a page calling it can only change the label, and
  // removing still asks in Misty's own window.
  let installed = false;
  let label = null;
  const showState = () => {
    if (label) label.textContent = installed ? 'Remove from Misty' : 'Add to Misty';
  };
  Object.defineProperty(window, '__MISTY_EXTENSION_STORE__', {
    value: (value) => {
      installed = value === true;
      showState();
    },
  });
  let askedFor = '';
  const ask = () => sendHostNavigation('misty-extension-store:state?token=' + encode(shortcutToken));
  const build = () => {
    const element = document.createElement('div');
    const shadow = element.attachShadow({ mode: 'closed' });
    const button = document.createElement('button');
    button.type = 'button';
    label = button;
    showState();
    // CSSOM, not a style attribute, so a store's style-src policy cannot strip it.
    button.style.cssText =
      'font:500 14px -apple-system,system-ui,sans-serif;background:#f2f2f2;color:#1c1c1e;border:1px solid #3a3a3c;' +
      'border-radius:999px;padding:10px 18px;cursor:pointer';
    button.addEventListener('click', (event) => {
      // Page scripts cannot produce trusted clicks.
      if (!event.isTrusted || performance.now() < pausedUntil) return;
      pausedUntil = performance.now() + 1500;
      const action = installed ? 'remove' : 'install';
      sendHostNavigation('misty-extension-store:' + action + '?token=' + encode(shortcutToken));
    });
    shadow.appendChild(button);
    return element;
  };
  // The stores are single-page apps that rebuild their documents as people browse.
  const update = () => {
    const parent = document.body || document.documentElement;
    if (!parent) return;
    // Prompts to switch browsers go on every store page, not only extension pages.
    if (!page.test(location.pathname)) {
      for (const banner of getBrowserBanners(null)) hide(banner);
      host?.remove();
      return;
    }
    host = host || build();
    // A new extension page starts as not added until Misty says otherwise.
    if (askedFor !== location.pathname) {
      askedFor = location.pathname;
      installed = false;
      showState();
      ask();
    }
    const button = storeButton();
    for (const banner of getBrowserBanners(button)) hide(banner);
    if (button) {
      // In the store button's place; theirs can't install anything here.
      if (host.nextElementSibling !== button) button.insertAdjacentElement('beforebegin', host);
      hide(button);
      place(inline);
    } else if (settled) {
      // No store button once the page has loaded (a new layout or locale): the corner.
      if (host.parentNode !== parent) parent.appendChild(host);
      place(floating);
    } else {
      // Still loading: wait for the store button rather than flash in the corner.
      host.remove();
    }
  };
  // Mutation callbacks run before the browser paints, so a banner or store button
  // is handled in the same frame it appears, never after it has shown. Our own
  // changes trigger one more pass, which finds everything in place and stops.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      update();
    });
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  let settled = false;
  window.addEventListener('load', () =>
    setTimeout(() => {
      settled = true;
      update();
    }, 1500),
  );
  // Address changes in the single-page store can leave the DOM briefly unchanged.
  window.addEventListener('popstate', update);
  // Adding or removing happens in Misty's window; ask again when people come back.
  window.addEventListener('focus', () => askedFor && ask());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && askedFor) ask();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && askedFor && page.test(location.pathname)) ask();
  }, 3000);
  setInterval(update, 1000);
  update();
})();
