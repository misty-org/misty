// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Edit an engine's own config: one pane per native config file (Claude Code's settings.json,
 * Codex's config.toml, Kimi's and Grok's config.toml, …). The panes come from native code, so
 * the window never names a path or format. Native code checks every file before writing any
 * and keeps the version it replaces.
 */
import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, Skeleton, Textarea } from "@/shared/ui";
import { channelsApi, type OfficialConfigFile } from "./api";
import { engineName } from "./engines";
import type { CliConfigState } from "./useCliConfig";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A quick JSON check so Save turns off before the round trip; TOML relies on native code. */
function jsonErrorOf(format: string, content: string): "syntax" | "object" | null {
  if (format !== "json") return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "object";
    return null;
  } catch {
    return "syntax";
  }
}

export function OfficialEditDialog({ cli }: { cli: CliConfigState }) {
  const { engine, officialEditing, setOfficialEditing, saveOfficialConfig, busy } = cli;
  const [files, setFiles] = useState<OfficialConfigFile[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  // A new edit target (reopened, or another engine) starts from fresh panes, set during render
  // so no stale panes flash.
  const editTarget = officialEditing ? engine : null;
  const [prevEditTarget, setPrevEditTarget] = useState(editTarget);
  if (editTarget !== prevEditTarget) {
    setPrevEditTarget(editTarget);
    setFiles(null);
    setDrafts({});
    setLoadError("");
    setSaveError("");
  }

  useEffect(() => {
    if (!officialEditing) return;
    let cancelled = false;
    channelsApi
      .officialRead(engine)
      .then((read) => {
        if (cancelled) return;
        setFiles(read);
        // A missing JSON file starts as an empty object so the first save passes the check.
        setDrafts(
          Object.fromEntries(
            read.map((file) => [
              file.path,
              file.exists || file.content ? file.content : file.format === "json" ? "{\n}\n" : "",
            ]),
          ),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [officialEditing, engine]);

  if (!officialEditing) return null;

  const invalid = (files ?? []).some(
    (file) => jsonErrorOf(file.format, drafts[file.path] ?? "") != null,
  );

  const formatJson = (path: string) => {
    try {
      const parsed: unknown = JSON.parse(drafts[path] ?? "");
      setDrafts((current) => ({ ...current, [path]: JSON.stringify(parsed, null, 2) + "\n" }));
    } catch {
      // Malformed JSON stays as typed; the pane already says so.
    }
  };

  const save = async () => {
    setSaveError("");
    const error = await saveOfficialConfig(
      (files ?? []).map((file) => ({ path: file.path, content: drafts[file.path] ?? "" })),
    );
    if (error) setSaveError(error);
  };

  const close = () => setOfficialEditing(false);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[86vh] w-[660px] max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogTitle className="pr-10 text-base">
          Edit {engineName(engine)}'s own config
        </DialogTitle>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1">
          {loadError ? (
            <p className="text-sm text-cream-muted" role="alert">
              {loadError}
            </p>
          ) : null}
          {!files && !loadError ? (
            <div className="grid gap-2" aria-label="Reading config files">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : null}
          {files?.map((file) => {
            const draft = drafts[file.path] ?? "";
            const jsonError = jsonErrorOf(file.format, draft);
            return (
              <div key={file.path} className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-cream-muted">
                    {file.path}
                  </code>
                  {file.format === "json" ? (
                    <Button type="button" size="sm" onClick={() => formatJson(file.path)}>
                      Format
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  rows={file.format === "json" && files.length > 1 ? 6 : 14}
                  spellCheck={false}
                  aria-label={file.path}
                  aria-invalid={jsonError != null || undefined}
                  className="font-mono text-xs whitespace-pre"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [file.path]: event.target.value }))
                  }
                />
                {jsonError ? (
                  <p className="text-xs text-cream-muted" role="alert">
                    {jsonError === "object" ? "Must be a JSON object" : "Invalid JSON"}
                  </p>
                ) : null}
              </div>
            );
          })}
          {saveError ? (
            <p className="text-sm text-cream-muted" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !files || invalid || Boolean(loadError)}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
