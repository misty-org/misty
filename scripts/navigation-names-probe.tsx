/** Disposable native-host acceptance: real config IPC and actual WebKit focus behavior. */
import React from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { Renameable } from "../src/features/navigation-names/Renameable";
import {
  useNavigationName,
  useNavigationNames,
  setNavigationName,
  refreshNavigationNames,
} from "../src/features/navigation-names/store";
import { providerNavigationTitles } from "../../misty-apps/apps/shared/navigationTitles";
const nonce = new URLSearchParams(location.search).get("nonce")!;
const account = JSON.stringify(["http://names-probe.invalid", nonce]);
useNavigationNames.setState({ account, ready: true, names: {}, error: null });
const titles = providerNavigationTitles({
  platform: "Instagram",
  title: "(2) Instagram • Messages",
  url: "https://instagram.com/direct/inbox/",
  inPlatform: true,
});
function Label({ id, title }: { id: string; title: string }) {
  const label = useNavigationName(id, title);
  return (
    <Renameable nameKey={id} automatic={title}>
      <button data-key={id}>{label}</button>
    </Renameable>
  );
}
createRoot(document.getElementById("root")!).render(
  <>
    <h1>Navigation names</h1>
    <Label id="section:social" title="Social" />
    <Label id="group:one" title="Social" />
    <Label id="tab:one" title={titles.tab} />
    <Label id="item:instagram" title="Instagram" />
    <Label id="pin:one" title="Messages" />
    <p>{titles.header}</p>
  </>,
);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn: () => unknown, message: string) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw new Error(message);
    await wait(30);
  }
}
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
let success = false,
  message = "";
try {
  await until(() => document.querySelector('[data-key="tab:one"]'), "Labels did not mount");
  await invoke("browser_webview_create", {
    request: {
      id: "navigation-names-fixture",
      url: location.origin + "/scripts/sdk-browser-page.html",
      x: 20,
      y: 210,
      width: 1060,
      height: 330,
      scopeId: "names-probe",
      theme: "dark",
    },
  });
  const tab = () => document.querySelector<HTMLButtonElement>('[data-key="tab:one"]')!;
  const open = async () => {
    await until(() => !document.querySelector('[role="menu"]'), "Previous menu did not dismiss");
    tab().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 300, clientY: 90 }),
    );
    await until(
      () =>
        [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === "Rename"),
      "Rename menu missing",
    );
    await wait(100);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    assert(
      items.length === 2 && items[0].textContent === "Rename" && items[1].textContent === "Reset",
      "Unexpected menu labels",
    );
    assert(
      items.every((item) => item.querySelector("svg")),
      "Menu icons are missing",
    );
    const itemStyle = getComputedStyle(items[0]);
    assert(
      parseFloat(getComputedStyle(menu).paddingTop) ===
        parseFloat(getComputedStyle(document.documentElement).fontSize) / 4 &&
        parseFloat(itemStyle.paddingTop) ===
          parseFloat(getComputedStyle(document.documentElement).fontSize) / 4 &&
        parseFloat(itemStyle.columnGap) ===
          parseFloat(getComputedStyle(document.documentElement).fontSize) / 2,
      `Menu spacing: outer ${getComputedStyle(menu).paddingTop}, item ${itemStyle.paddingTop}, gap ${itemStyle.columnGap}, font ${itemStyle.fontSize}`,
    );
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((e) => e.textContent === "Rename")!
      .click();
    await until(
      () => document.querySelector('input[aria-label^="Rename"]'),
      "Inline editor missing",
    );
    return document.querySelector<HTMLInputElement>('input[aria-label^="Rename"]')!;
  };
  let input = await open();
  assert(document.activeElement === input, "Editor did not receive focus");
  assert(input.selectionEnd === input.value.length, "Text was not selected");
  input.value = "My messages";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await until(
    () => tab().textContent === "My messages" && !document.querySelector("input"),
    "Native alias did not commit",
  );
  assert(document.activeElement === tab(), "Focus did not return to tab");
  const saved = await invoke<{ names: Record<string, string> }>("navigation_names_snapshot", {
    account,
  });
  assert(saved.names["tab:one"] === "My messages", "Native file did not retain alias");
  useNavigationNames.setState({ names: {} });
  await refreshNavigationNames(account);
  assert(useNavigationNames.getState().names["tab:one"] === "My messages", "Reload lost alias");
  await Promise.all([
    setNavigationName("section:social", "Friends"),
    setNavigationName("group:one", "Chats"),
  ]);
  assert(
    useNavigationNames.getState().names["section:social"] === "Friends" &&
      useNavigationNames.getState().names["group:one"] === "Chats",
    "Concurrent edits lost an alias",
  );
  input = await open();
  input.value = "Canceled";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => !document.querySelector("input"), "Escape did not dismiss");
  assert(tab().textContent === "My messages", "Escape saved text");
  await setNavigationName("tab:one", null);
  await until(() => tab().textContent === titles.tab, "Reset did not reveal automatic title");
  const other = await invoke<{ names: Record<string, string> }>("navigation_names_snapshot", {
    account: account + "-other",
  });
  assert(Object.keys(other.names).length === 0, "Account isolation failed");
  await invoke("browser_webview_close", { request: { id: "navigation-names-fixture" } });
  success = true;
  message =
    "PASS: native config save/reload/reset/isolation, concurrent edits, inline selection, Enter, Escape and focus restoration with a child webview.";
} catch (error) {
  message = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
}
document.getElementById("result")!.textContent = message;
await invoke("sdk_probe_complete", { nonce, success, message });
