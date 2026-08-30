import { MistyFilePicker } from "@/features/picker";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui";

export function OpenFolderCard({ onOpenRoot }: { onOpenRoot: (path: string) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className="code-theme-editor grid h-full place-items-center bg-charcoal-workspace p-8 text-cream">
      <div className="w-full max-w-md rounded-2xl border border-charcoal-border bg-charcoal-card p-7 text-center shadow-xl">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-charcoal-active text-cream-bright">
          <FolderOpen size={22} strokeWidth={1.7} />
        </div>
        <h1 className="text-lg font-medium tracking-tight text-cream-bright">Open a folder</h1>
        <p className="mt-2 text-sm leading-6 text-cream-muted">
          Point Misty at a project directory to browse files, edit them, and run{" "}
          <span className="font-mono text-[12px] text-cream">claude</span>,{" "}
          <span className="font-mono text-[12px] text-cream">codex</span>, or any other CLI from the
          built-in terminal.
        </p>
        <div className="mt-6 flex justify-center">
          <Button type="button" onClick={() => setPickerOpen(true)} variant="default">
            Choose folder
          </Button>
        </div>
      </div>

      {pickerOpen ? (
        <MistyFilePicker
          mode="folder"
          title="Open project folder"
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            onOpenRoot(path);
          }}
        />
      ) : null}
    </section>
  );
}
