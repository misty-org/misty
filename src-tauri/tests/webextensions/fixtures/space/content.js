// SPDX-License-Identifier: MIT
// Records what this Space's extension storage held, then claims it for this Space.
(async () => {
  const space = new URLSearchParams(location.search).get('space');
  const { space: before } = await browser.storage.local.get('space');
  await browser.storage.local.set({ space });
  document.documentElement.dataset.before = before || 'none';
  document.documentElement.dataset.ext = 'ran';
})();
