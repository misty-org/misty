import { setUiStorage } from "@misty/ui";
import type { StoreApi, UseBoundStore } from "zustand";
import { createDeviceSetting, type DeviceSetting } from "./deviceSetting";

/**
 * Keeps what @misty/ui's components remember for this device (a collection's view and filters) in
 * `misty.db`, like every other device setting, instead of the webview's localStorage. One device
 * setting per scope, made and loaded the first time a component asks for it.
 */
export function installUiStorage() {
  const settings = new Map<string, UseBoundStore<StoreApi<DeviceSetting<unknown>>>>();
  const setting = (scope: string) => {
    let store = settings.get(scope);
    if (!store) {
      store = createDeviceSetting<unknown>({ scope, defaults: undefined });
      settings.set(scope, store);
      if (!store.getState().loaded) void store.getState().load();
    }
    return store;
  };
  setUiStorage({
    read: (scope) => setting(scope).getState().value,
    write: (scope, value) => setting(scope).getState().set(value),
    subscribe: (scope, listener) => setting(scope).subscribe(listener),
  });
}
