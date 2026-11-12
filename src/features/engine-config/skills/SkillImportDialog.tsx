// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Import a local skill: pick a folder (mapped back to a path relative to an engine's skills
 * folder), choose which engines get a managed copy, then import.
 *
 * The backend only accepts a relative folder inside a known skills root, so no arbitrary path
 * crosses IPC. The picker maps an absolute pick onto a root; anything else must be typed as a
 * relative folder and is still checked natively.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
} from "@/shared/ui";
import { EngineGlyph } from "./components";
import { t } from "./strings";
import type { SkillTargetId, SkillTargetInfo } from "./types";
import { defaultTargets, relativeToRoot } from "./utils";

export function SkillImportDialog({
  targets,
  busy,
  onClose,
  onImport,
}: {
  targets: SkillTargetInfo[];
  busy: boolean;
  onClose: () => void;
  onImport: (directory: string, engineTargets: SkillTargetId[]) => void;
}) {
  // Installed CLIs first: importing into an engine that isn't installed would write a copy
  // nothing reads. (The backend accepts every id.)
  const offered = useMemo(() => targets.filter((target) => target.available !== false), [targets]);
  const offeredList = offered.length > 0 ? offered : targets;
  const [directory, setDirectory] = useState("");
  const [selected, setSelected] = useState<SkillTargetId[]>(() => defaultTargets(offeredList));
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const roots = useMemo(
    () => targets.map((target) => `${target.label}: ${target.path}`).join("\n"),
    [targets],
  );

  const pick = async () => {
    setPickerError(null);
    const picked = await open({ directory: true, multiple: false, title: t("import.pickTitle") });
    if (typeof picked !== "string") return;
    const mapped = relativeToRoot(picked, targets);
    if (!mapped) {
      setPickerError(t("import.outsideRoots", { roots }));
      return;
    }
    setDirectory(mapped.directory);
  };

  const toggleTarget = (id: SkillTargetId, next: boolean) => {
    setSelected((previous) =>
      next ? [...new Set([...previous, id])] : previous.filter((target) => target !== id),
    );
  };

  const trimmed = directory.trim();
  const canImport = trimmed.length > 0 && selected.length > 0 && !busy;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="skill-import-directory">{t("import.directoryLabel")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="skill-import-directory"
              placeholder={t("import.directoryPlaceholder")}
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              className="flex-1"
            />
            <Button onClick={() => void pick()}>{t("import.pick")}</Button>
          </div>
          {pickerError ? (
            <p role="alert" className="whitespace-pre-line text-xs text-cream-bright">
              {pickerError}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium text-cream-bright">{t("import.targets")}</p>
          {offeredList.map((target) => (
            <label
              key={target.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-cream"
            >
              <Checkbox
                checked={selectedSet.has(target.id as SkillTargetId)}
                onCheckedChange={(next) => toggleTarget(target.id as SkillTargetId, next === true)}
              />
              <EngineGlyph engine={target.id} label={target.label} />
              {target.label}
            </label>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!canImport}
            onClick={() => onImport(trimmed, selected)}
          >
            {busy ? <Spinner size="sm" label={false} /> : null}
            {t("import.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
