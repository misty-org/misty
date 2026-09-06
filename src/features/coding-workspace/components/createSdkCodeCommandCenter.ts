import type { createSdkCodeRuntime } from "../sdkCodeRuntime";
import type { createSdkCodeSearch } from "../sdkCodeSearch";
import { createCodeCommandCenter, type CodeCommandCenterServices } from "./createCodeCommandCenter";

export function createSdkCodeCommandCenter(
  runtime: ReturnType<typeof createSdkCodeRuntime>,
  search: ReturnType<typeof createSdkCodeSearch>,
  ui: Pick<CodeCommandCenterServices, "events" | "ShortcutHint">,
) {
  return createCodeCommandCenter({
    ...ui,
    store: runtime.store,
    loadIndex: async (root) => (root ? search.loadIndex(root) : { files: [] }),
    search: search.search,
    subscribeIndex: (root, listener) =>
      runtime.hasProject(root)
        ? runtime.subscribeProject(root, () => {
            search.invalidate(root);
            listener();
          })
        : () => undefined,
  });
}
