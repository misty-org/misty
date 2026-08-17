import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useCallback, useState } from "react";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

export function OpenFolderCard() {
  const setRootPath = useCodingWorkspaceStore((state) => state.setRootPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string" && selection.length > 0) {
        setRootPath(selection);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Could not open that folder.",
      );
    } finally {
      setBusy(false);
    }
  }, [setRootPath]);

  return (
    <section className="grid h-full place-items-center bg-charcoal-workspace p-8 text-cream">
      <div className="w-full max-w-md rounded-2xl border border-charcoal-border bg-charcoal-card p-7 text-center shadow-xl">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-charcoal-active text-cream-bright">
          <FolderOpen size={22} strokeWidth={1.7} />
        </div>
        <h1 className="text-lg font-medium tracking-tight text-cream-bright">Open a folder</h1>
        <p className="mt-2 text-sm leading-6 text-cream-muted">
          Point Misty at a project directory to browse files, edit them, and run{" "}
          <span className="font-mono text-[12px] text-cream">claude</span>,{" "}
          <span className="font-mono text-[12px] text-cream">codex</span>, or any other CLI
          from the built-in terminal.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void pick()}
          className={[
            "mt-6 inline-flex h-9 items-center gap-2 rounded-md border border-charcoal-border",
            "bg-charcoal-hover px-4 text-sm text-cream-bright hover:bg-charcoal-active",
            "disabled:opacity-50",
          ].join(" ")}
        >
          {busy ? "Opening…" : "Choose folder"}
        </button>
        {error ? <p className="mt-3 text-xs text-[#d68b80]">{error}</p> : null}
      </div>
    </section>
  );
}
