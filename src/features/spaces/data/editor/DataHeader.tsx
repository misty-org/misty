import { useEffect, useState, type ReactNode } from "react";
import { BackButton, Input, Surface, useNotice } from "@/shared/ui";

/**
 * The workbook page's one bar: back to Data, the title (renamed in place), then the page's tools
 * and, at its end, who's here and the ⋯ menu.
 */
export function DataHeader(props: {
  title: string;
  canRename: boolean;
  onBack?: () => void;
  onRename(title: string): Promise<unknown>;
  reportError?(error: unknown): void;
  tools?: ReactNode;
  end?: ReactNode;
}) {
  const [title, setTitle] = useState(props.title);
  const [saved, setSaved] = useState(props.title);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useNotice(failed, {
    message: "Title not saved. Press Enter in the title to try again.",
    tone: "error",
    onDismiss: () => setFailed(false),
  });
  useEffect(() => {
    setTitle(props.title);
    setSaved(props.title);
    setFailed(false);
  }, [props.title]);

  const save = async () => {
    if (saving || !props.canRename || title === saved) return;
    const next = title.trim() || "Untitled data";
    setTitle(next);
    if (next === saved) return;
    setSaving(true);
    setFailed(false);
    try {
      await props.onRename(next);
      setSaved(next);
    } catch (error) {
      setFailed(true);
      props.reportError?.(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Surface
      as="header"
      tone="page"
      className="flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pl-1 pr-3"
    >
      {props.onBack ? <BackButton onClick={props.onBack} aria-label="Back to Data" /> : null}
      <div className="flex min-w-24 max-w-md flex-1 items-center">
        <Input
          variant="title"
          value={title}
          aria-label="Data title"
          aria-invalid={failed || undefined}
          readOnly={saving || !props.canRename}
          onChange={(event) => {
            setTitle(event.target.value);
            setFailed(false);
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setTitle(saved);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="flex min-w-0 flex-1 justify-center">{props.tools}</div>
      <div className="flex shrink-0 items-center gap-2">{props.end}</div>
    </Surface>
  );
}
