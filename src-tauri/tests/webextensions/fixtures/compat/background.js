// SPDX-License-Identifier: MIT
// A blocking listener; WebKit ignores its answer until Misty learns it as a rule.
browser.webRequest.onBeforeRequest.addListener(
  (details) => (details.url.includes("misty-block=") ? { cancel: true } : undefined),
  { urls: ["http://127.0.0.1/*"] },
  ["blocking"],
);
