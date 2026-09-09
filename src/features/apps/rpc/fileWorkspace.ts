import type { MistyFileWorkspaceOptions, MistyFileWorkspaceMount } from "@misty/sdk";
import { AppRpcError, type AppRpcScope } from "./session";

export interface FileWorkspaceRegistration {
  root: HTMLElement;
  options: MistyFileWorkspaceOptions;
}
export function createFileWorkspaceMount(
  scope: AppRpcScope,
  container: HTMLElement,
  render: (view: FileWorkspaceRegistration | null) => void,
) {
  let current: FileWorkspaceRegistration | null = null;
  const assert = () => {
    // The complete shared workspace exposes the same capabilities as the Files App.
    for (const capability of [
      "files.read",
      "files.write",
      "connections.read",
      "connections.write",
      "navigation.write",
    ])
      scope.assert(capability);
  };
  const validate = (options: MistyFileWorkspaceOptions) => {
    if (!options || !["explorer", "transfers"].includes(options.view))
      throw new AppRpcError("invalid_view", "Unknown file workspace.");
    return { view: options.view, active: options.active !== false };
  };
  scope.signal.addEventListener(
    "abort",
    () => {
      current = null;
      render(null);
    },
    { once: true },
  );
  return async (
    root: HTMLElement,
    options: MistyFileWorkspaceOptions,
  ): Promise<MistyFileWorkspaceMount> => {
    assert();
    if (!(root instanceof HTMLElement) || !container.contains(root))
      throw new AppRpcError("invalid_root", "Mount the workspace inside this App view.");
    if (current)
      throw new AppRpcError("already_mounted", "This App view already contains a file workspace.");
    const mounted = { root, options: validate(options) };
    current = mounted;
    render(mounted);
    return {
      update(options) {
        assert();
        if (current !== mounted)
          throw new AppRpcError("view_closed", "The file workspace has closed.");
        mounted.options = validate(options);
        render({ ...mounted });
      },
      unmount() {
        if (current === mounted) {
          current = null;
          render(null);
        }
      },
    };
  };
}
