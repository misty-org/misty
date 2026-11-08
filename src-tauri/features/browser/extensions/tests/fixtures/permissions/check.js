// SPDX-License-Identifier: MIT
// Each check tries an API and records what came back, for the native probe to judge.
window.runChecks = async () => {
  const results = {};
  const record = async (name, check) => {
    try {
      // A call that never answers counts against it, instead of hanging every check after it.
      const late = new Promise((_, reject) => setTimeout(() => reject(new Error("no answer")), 20000));
      results[name] = await Promise.race([check(), late]);
    } catch (error) {
      results[name] = `error: ${error.message}`;
    }
  };
  // Answered by WebKit's own runtime from what's granted.
  await record("storage", async () => {
    await browser.storage.local.set({ mine: "kept" });
    return (await browser.storage.local.get("mine")).mine;
  });
  await record("cookies", async () => (await browser.cookies.getAll({})).length);
  await record("webNavigation", async () => typeof browser.webNavigation?.onCommitted);
  await record("rules", async () => (await browser.declarativeNetRequest.getDynamicRules()).length);
  // A tab on a host it wasn't granted can't be found by its address, and hides its address.
  const addresses = async (url) => (await browser.tabs.query({ url })).map((tab) => tab.url ?? "hidden").join(",");
  await record("grantedTab", () => addresses("http://127.0.0.1/*"));
  await record("ungrantedTab", () => addresses("http://localhost/*"));
  // Answered by Misty's native host from the descriptor.
  await record("history", async () => (await browser.history.search({ text: "" })).length);
  await record("bookmarks", async () => (await browser.bookmarks.getTree()).length);
  await record("downloads", async () => (await browser.downloads.search({})).length);
  await record("downloadsOpen", () => browser.downloads.open(1));
  await record("cookieHeader", () =>
    browser.downloads.download({ url: "http://127.0.0.1:1/x", headers: [{ name: "Cookie", value: "stolen=1" }] }),
  );
  await record("browsingData", () => browser.browsingData.removeCache({}));
  return results;
};
