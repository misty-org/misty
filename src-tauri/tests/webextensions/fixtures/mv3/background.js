// SPDX-License-Identifier: MIT
browser.runtime.onMessage.addListener((message) => {
  if (message.probe === "background") return Promise.resolve({ background: true });
});
