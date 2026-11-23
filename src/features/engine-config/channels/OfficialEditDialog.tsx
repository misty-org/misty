// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  SkeletonControl,
  Text,
  Textarea,
  DialogFooter,
} from "@misty/ui";
import { channelsApi, type OfficialConfigFile } from "./api";
import { engineName } from "./engines";
import type { CliConfigState } from "./use_cli_config";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
    } catch {}
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
        className="flex max-h-[86vh] w-165 max-w-[94vw] flex-col gap-4 p-5"
      >
        <DialogHeader>
          <DialogTitle>Edit {engineName(engine)}'s own config</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1">
          {loadError ? (
            <Text size="meta" tone="muted" wrap role="alert">
              {loadError}
            </Text>
          ) : null}
          {!files && !loadError ? (
            <div
              role="status"
              aria-busy="true"
              className="grid gap-2"
              aria-label="Reading config files"
            >
              <div className="flex h-6 items-center justify-between gap-2">
                <Skeleton className="h-3 w-2/3" />
                <SkeletonControl kind="button-sm" />
              </div>
              <Skeleton className="h-67 w-full rounded-lg" />
            </div>
          ) : null}
          {files?.map((file) => {
            const draft = drafts[file.path] ?? "";
            const jsonError = jsonErrorOf(file.format, draft);
            return (
              <div key={file.path} className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Text size="meta" tone="muted" full className="min-w-0 flex-1">
                    {file.path}
                  </Text>
                  {file.format === "json" ? (
                    <Button type="button" size="sm" onClick={() => formatJson(file.path)}>
                      Format
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  variant="code"
                  rows={file.format === "json" && files.length > 1 ? 6 : 14}
                  aria-label={file.path}
                  aria-invalid={jsonError != null || undefined}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [file.path]: event.target.value }))
                  }
                />
                {jsonError ? (
                  <Text size="meta" tone="muted" wrap role="alert">
                    {jsonError === "object" ? "Must be a JSON object" : "Invalid JSON"}
                  </Text>
                ) : null}
              </div>
            );
          })}
          {saveError ? (
            <Text size="meta" tone="muted" wrap role="alert">
              {saveError}
            </Text>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="quiet" onClick={close}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
