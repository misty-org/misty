import "@/styles/styles.css";
import { defineComponentApp, type MistyComponentContext } from "@misty/sdk";

/** The package composes Misty's complete reusable file workspace and native transfer history. */
export default defineComponentApp({
  appId: "files",
  protocol: 2,
  async mount({root, misty, context, signal}) {
    root.className = "h-full min-h-0";
    const options = (context: MistyComponentContext) => ({
      view: new URL(context.route, "https://misty.local").searchParams.get("view") === "transfers"
        ? "transfers" as const : "explorer" as const,
      active: context.active,
    });
    await misty.navigation.setItems([
      {id:"explorer", label:"Explorer", route:"/apps/files"},
      {id:"transfers", label:"Transfers", route:"/apps/files?view=transfers"},
    ]);
    const workspace = await misty.fileSystem.mountWorkspace(root, options(context));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      workspace.unmount();
      signal?.removeEventListener("abort", close);
    };
    signal?.addEventListener("abort", close, {once:true});
    if (signal?.aborted) close();
    return {update(next) {if (!closed) workspace.update(options(next));}, unmount:close};
  },
});
