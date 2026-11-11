import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";
import { Button, ErrorNotification, Skeleton } from "@/shared/ui";
import { errorText, projectApi, type ProjectFile } from "./projectApi";

/** A file's text in a code editor. Saving writes it back; a file too long to read whole, or one
 * that isn't text, can only be looked at. */
export default function FileEditor({ path, name }: { path: string; name: string }) {
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<Extension[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void projectApi
      .readFile(path)
      .then((read) => {
        if (!live) return;
        setFile(read);
        setText(read.text);
      })
      .catch((reason) => live && setError(errorText(reason)));
    const described = LanguageDescription.matchFilename(languages, name);
    void described
      ?.load()
      .then((support) => live && setLanguage([support]))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path, name]);
  if (!file)
    return (
      <div className="grid gap-2 p-3" aria-hidden={!error}>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
        <ErrorNotification message={error} onDismiss={() => setError("")} />
      </div>
    );
  if (file.kind === "binary")
    return (
      <p className="p-4 text-sm text-cream-muted">
        This file isn't text, so it can't be shown here.
      </p>
    );
  const dirty = text !== file.text;
  const save = () => {
    setSaving(true);
    void projectApi
      .writeFile(path, text)
      .then(() => setFile({ ...file, text }))
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="context-editor min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={text}
          theme="dark"
          extensions={language}
          editable={!file.truncated}
          basicSetup={{ foldGutter: false }}
          onChange={setText}
        />
      </div>
      {file.truncated ? (
        <p className="context-foot text-xs text-cream-muted">
          This file is too long to edit here. Its first part is shown.
        </p>
      ) : dirty ? (
        <div className="context-foot">
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setText(file.text)}>
            Discard
          </Button>
        </div>
      ) : null}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </div>
  );
}
