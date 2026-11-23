export const startup = (async () => {
  const legacyCompanion = new URLSearchParams(location.search).get("cursor_companion");
  if (legacyCompanion !== null && "__TAURI_INTERNALS__" in window) {
    if (legacyCompanion === "controls") {
      document.body.style.cssText =
        "margin:0;background:#111;color:#e8e6e3;font:14px/1.5 system-ui";
      const message = document.createElement("p");
      message.style.padding = "20px";
      message.textContent =
        "Companion controls have moved to Agents. Restart Misty to finish updating.";
      document.getElementById("root")?.replaceChildren(message);
    } else await (await import("./cursor_entry")).cursorStartup;
    return;
  }
  await (
    await import("./HostMain")
  ).startup;
})();
