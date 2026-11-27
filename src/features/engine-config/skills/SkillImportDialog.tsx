// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { useMemo, useState } from "react";
import { pickPaths } from "@/shared/lib/file_pick";
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
  Text,
} from "@misty/ui";
import { EngineGlyph } from "./Components";
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
    const [picked] = await pickPaths({ folders: true, title: t("import.pickTitle") });
    if (!picked) return;
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
      <DialogContent className="max-w-110">
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
            <Text
              size="meta"
              bare
              as="p"
              role="alert"
              tone="bright"
              className="whitespace-pre-line"
            >
              {pickerError}
            </Text>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Text size="control" bare as="p" tone="bright" weight="medium">
            {t("import.targets")}
          </Text>
          {offeredList.map((target) => (
            <label key={target.id} className="flex cursor-pointer items-center gap-2 text-control">
              <Checkbox
                checked={selectedSet.has(target.id as SkillTargetId)}
                onCheckedChange={(next) => toggleTarget(target.id as SkillTargetId, next === true)}
              />
              <EngineGlyph engine={target.id} label={target.label} />
              <Text bare tone="default">
                {target.label}
              </Text>
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
            disabled={!canImport || busy}
            onClick={() => onImport(trimmed, selected)}
          >
            {t("import.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
