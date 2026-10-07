// SPDX-License-Identifier: MIT
browser.storage.onChanged.addListener((changes, area) => {
  window.webkit.messageHandlers.probe.postMessage({ event: "changed", area, changes });
});
const ready = async () => {
  const data = await browser.storage.sync.get(null);
  let reply;
  for (let i=0; i<30 && !reply?.background; i++) {
    try { reply = await browser.runtime.sendMessage({ probe: "background" }); } catch {}
    if (!reply?.background) await new Promise(resolve => setTimeout(resolve,100));
  }
  window.webkit.messageHandlers.probe.postMessage({ event: "ready", data, reply: reply ?? {} });
};
ready().catch(error => window.webkit.messageHandlers.probe.postMessage({event:"error",message:String(error)}));
