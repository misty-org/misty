// SPDX-License-Identifier: MIT
// Each check records its value or its error message for the native probe.
window.runChecks = async () => {
  const results = {};
  const record = async (name, check) => {
    try {
      results[name] = await check();
    } catch (error) {
      results[name] = `error: ${error.message}`;
    }
  };
  await record("browserInfo", async () => (await browser.runtime.getBrowserInfo()).name);
  await record("self", async () => (await browser.management.getSelf()).name);
  await record("managed", async () => JSON.stringify(await browser.storage.managed.get()));
  await record("language", async () =>
    (await browser.i18n.detectLanguage("Bonjour à tous, comment allez-vous aujourd'hui ? Nous espérons que tout va bien chez vous.")).languages[0]?.language,
  );
  await record("idle", () => browser.idle.queryState(60));
  await record("history", async () => (await browser.history.search({ text: "" }))[0]?.url);
  await record("notification", () => browser.notifications.create("probe", { type: "basic", title: "Probe", message: "Hello" }));
  await record("browsingData", async () => {
    await browser.browsingData.removeCache({});
    return "removed";
  });
  await record("redirect", () => browser.identity.getRedirectURL("done"));
  await record("move", async () => {
    // Match patterns cannot name a port.
    const [tab] = await browser.tabs.query({ url: "http://127.0.0.1/*" });
    await browser.tabs.move(tab.id, { index: 0 });
    return "moved";
  });
  return results;
};
