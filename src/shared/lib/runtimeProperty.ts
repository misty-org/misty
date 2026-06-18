/** Inspecting a lazy service must not require its application session to be mounted. */
export function runtimeProperty(target: object, key: string | symbol, read: () => unknown) {
  if (typeof key === "symbol" || key in target || ["$$typeof", "displayName", "then", "name", "length", "prototype"].includes(key))
    return Reflect.get(target, key);
  return read();
}
