// SPDX-License-Identifier: MIT
(() => {
  document.documentElement.dataset.mistyFixture = "content-started";
  const attempt = (remaining) => browser.runtime.sendMessage({probe:"background"}).then(reply => {
    if (reply?.background) document.documentElement.dataset.mistyFixture = "content-and-background";
    else if (remaining) setTimeout(() => attempt(remaining-1),100);
  }).catch(() => { if (remaining) setTimeout(() => attempt(remaining-1),100); });
  attempt(30);
})();
