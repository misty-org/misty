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
  type Parser = NonNullable<MistyFileWorkspaceOptions["extractDocumentText"]>;
  const parsers = new WeakMap<Parser, Parser>();
  const scopedParser = (parse: Parser | undefined): Parser | undefined => {
    if (!parse) return;
    let scoped = parsers.get(parse);
    if (!scoped) {
      scoped = async (extension, bytes) => {
        assert();
        const result = await parse(extension, bytes);
        assert();
        return result;
      };
      parsers.set(parse, scoped);
    }
    return scoped;
  };
  const validate = (options: MistyFileWorkspaceOptions) => {
    if (!options || !["explorer", "transfers"].includes(options.view))
      throw new AppRpcError("invalid_view", "Unknown file workspace.");
    if (
      [
        options.renderPdf,
        options.renderVideo,
        options.renderPhoto,
        options.extractDocumentText,
      ].some((renderer) => renderer !== undefined && typeof renderer !== "function")
    )
      throw new AppRpcError("invalid_renderer", "The preview renderer is invalid.");
    return {
      view: options.view,
      active: options.active !== false,
      extractDocumentText: scopedParser(options.extractDocumentText),
      renderPdf: options.renderPdf,
      renderPhoto: options.renderPhoto,
      renderVideo: options.renderVideo,
    };
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
