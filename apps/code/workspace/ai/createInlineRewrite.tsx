import { PencilLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface InlineRewriteProps {
  open: boolean;
  selection: string;
  language: string;
  filename: string;
  onClose: () => void;
  onApply: (text: string) => void;
  onOpenSettings: () => void;
}

export function createInlineRewrite(services: {
  useSettings(): {providerId: string; model: string};
  rewrite(input: {instruction:string; selection:string; language:string; filename:string; signal:AbortSignal; onDelta(delta:string):void}): Promise<void>;
  useShortcutHandler(id: "code.apply_inline_ai", run:()=>void, active:()=>boolean):void;
  ShortcutHint: React.ComponentType<{commandId:string}>;
  SystemErrorActivity: React.ComponentType<{error:string; scope:string; title:string; target:{kind:"route";href:string}}>;
}) {
const {useShortcutHandler, ShortcutHint, SystemErrorActivity} = services;
return function InlineRewrite({
  open,
  selection,
  language,
  filename,
  onClose,
  onApply,
  onOpenSettings,
}: InlineRewriteProps) {
  const settings = services.useSettings();
  const [instruction, setInstruction] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setPreview("");
    setError(null);
    setStreaming(false);
    controllerRef.current?.abort();
    controllerRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const run = useCallback(async () => {
    setError(null);
    setPreview("");
    setStreaming(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      let acc = "";
      await services.rewrite({
        instruction,
        selection,
        language,
        filename,
        signal: controller.signal,
        onDelta: (delta) => {
          acc += delta;
          setPreview(acc);
        },
      });
    } catch (nextError) {
      if (controller.signal.aborted) return;
      setError(nextError instanceof Error ? nextError.message : "Model request failed.");
    } finally {
      if (!controller.signal.aborted) setStreaming(false);
    }
  }, [
    filename,
    instruction,
    language,
    selection,
    settings.model,
    settings.providerId,
  ]);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!instruction.trim()) return;
      void run();
    },
    [instruction, run],
  );

  const apply = useCallback(() => {
    if (!preview.trim()) return;
    onApply(preview.trimEnd());
    onClose();
  }, [preview, onApply, onClose]);

  useShortcutHandler("code.apply_inline_ai", apply, () => open && Boolean(preview.trim()));

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setStreaming(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, cancel, onClose]);

  useEffect(() => () => controllerRef.current?.abort(), []);
  if (!open) return null;

  return (
    <div className="code-theme-overlay fixed inset-x-0 top-16 z-40 mx-auto flex justify-center bg-transparent px-4">
      <div className="w-full max-w-2xl rounded-xl border border-charcoal-border bg-charcoal-card shadow-2xl">
        <form onSubmit={submit} className="border-b border-charcoal-border px-4 py-3">
          <div className="flex items-start gap-3">
            <PencilLine size={16} className="code-accent mt-1" />
            <textarea
              ref={inputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={`Rewrite this ${language || "code"}… e.g. "make async", "add JSDoc", "extract to hook"`}
              rows={2}
              spellCheck={false}
              className="min-h-[42px] flex-1 resize-none bg-transparent text-sm text-cream outline-none placeholder:text-cream-muted"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-6 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
            >
              <X size={13} />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-cream-muted">
            <span>
              {settings.providerId === "anthropic" ? "Anthropic" : "OpenAI-compat"} ·{" "}
              <span className="font-mono">{settings.model}</span> ·{" "}
              <button type="button" onClick={onOpenSettings} className="underline hover:text-cream">
                configure
              </button>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-cream-muted/70">
                {selection.length.toLocaleString()} chars selected
              </span>
              <button
                type="submit"
                disabled={streaming || !instruction.trim()}
                className="rounded-md bg-cream-bright px-3 py-1 font-medium text-charcoal-workspace hover:bg-cream disabled:opacity-60"
              >
                {streaming ? "Streaming…" : "Rewrite"}
              </button>
            </span>
          </div>
        </form>

        {preview || streaming ? (
          <div className="max-h-[40vh] overflow-auto bg-charcoal-bg p-3">
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.6] text-cream">
              {preview || "Waiting for first tokens…"}
            </pre>
          </div>
        ) : null}

        {error ? (
          <SystemErrorActivity
            error={error}
            scope={`code:rewrite:${filename}`}
            title="Rewrite could not be completed"
            target={{ kind: "route", href: "/code" }}
          />
        ) : null}

        {preview ? (
          <div className="flex items-center justify-end gap-2 border-t border-charcoal-border px-3 py-2">
            {streaming ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded-md border border-charcoal-border px-3 py-1 text-xs text-cream-muted hover:text-cream"
              >
                Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={apply}
              disabled={!preview.trim()}
              className="rounded-md bg-cream-bright px-3 py-1 text-xs font-medium text-charcoal-workspace hover:bg-cream disabled:opacity-60"
            >
              Apply <ShortcutHint commandId="code.apply_inline_ai" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

}
