import { setUiStorage } from "@misty/ui";
import type { StoreApi, UseBoundStore } from "zustand";
import { createDeviceSetting, type DeviceSetting } from "./device_setting";

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
