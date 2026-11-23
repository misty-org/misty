// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

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

export type UpdateMap = Record<string, boolean>;

export type BusyTarget = { skillId: string; targetId: string };

export type ConfirmState =
  | { kind: "uninstall"; skill: SkillRow }
  | { kind: "deleteLocal"; skill: SkillRow }
  | { kind: "overwrite"; skill: SkillRow };

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
              <li key={path} className="break-all">
                <Text bare size="meta" tone="muted">
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
