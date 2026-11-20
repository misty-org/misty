// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * What Explore's Skills section shares from the old pane: the update map, the confirm state and
 * the destructive-confirm dialog.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Surface,
  Text,
} from "@misty/ui";

import { t } from "./strings";
import type { SkillRow } from "./types";

/** The update map is keyed by skill id; local (unmanaged) entries never have upstream updates. */
export type UpdateMap = Record<string, boolean>;

/** Engine toggle currently in flight: only that row's icon is disabled. */
export type BusyTarget = { skillId: string; targetId: string };

export type ConfirmState =
  | { kind: "uninstall"; skill: SkillRow }
  | { kind: "deleteLocal"; skill: SkillRow }
  | { kind: "overwrite"; skill: SkillRow };

/** Uninstall, local delete and overwrite confirmation. */
export function SkillConfirmDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = confirm.skill.name;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirm.kind === "uninstall"
              ? t("confirm.uninstallTitle", { name })
              : confirm.kind === "deleteLocal"
                ? t("confirm.deleteTitle", { name })
                : t("confirm.overwriteTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm.kind === "uninstall"
              ? t("confirm.uninstallBody")
              : confirm.kind === "deleteLocal"
                ? t("confirm.deleteBody")
                : t("confirm.overwriteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirm.kind === "deleteLocal" && confirm.skill.targetPaths ? (
          <Surface as="ul" tone="page" radius="md" className="flex flex-col gap-1 p-2">
            {Object.values(confirm.skill.targetPaths).map((path) => (
              <li key={path} className="break-all text-xs">
                <Text bare tone="muted">
                  {path}
                </Text>
              </li>
            ))}
          </Surface>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirm.kind === "overwrite"
              ? t("confirm.overwriteConfirm")
              : confirm.kind === "uninstall"
                ? t("actions.uninstall")
                : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
