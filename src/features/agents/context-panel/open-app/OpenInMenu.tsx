// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  IconButton,
  MenuItem,
  MenuSubmenu,
  MenuTrigger,
  Skeleton,
  useNotice,
} from "@/shared/ui";
import { useFolderSettings } from "../folders/folderSettings";
import { useFilesStore } from "../files/filesStore";
import { isWithinDirectory } from "../files/repositorySelection";
import {
  availableTargets,
  chosenTarget,
  customTargetId,
  openInTarget,
  useOpenApps,
  type OpenAppTarget,
} from "./openApp";
import "./openApp.css";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** An app's own icon, or its first letter where the system gave none. */
function TargetIcon({ target, icon }: { target: OpenAppTarget; icon?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (icon && broken !== icon)
    return (
      <img
        src={icon}
        alt=""
        aria-hidden="true"
        className="open-app-icon"
        onError={() => setBroken(icon)}
      />
    );
  return (
    <span aria-hidden="true" className="open-app-letter">
      {target.label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** What a target opens: the file shown in the editor, except in the file manager, which shows
 * the folder. */
export function openInPath(
  target: OpenAppTarget,
  folder: string,
  activeFilePath: string | null,
): string {
  if (target.id === "finder") return folder;
  return activeFilePath && isWithinDirectory(folder, activeFilePath) ? activeFilePath : folder;
}

/**
 * "Open in" for the panel's head: one button that opens the file shown in the editor (or the
 * folder, when none is) in the app chosen last for the folder, and a menu of every app on this
 * computer (the chosen one checked), the person's own programs, and a way to add one through the
 * system's file dialog.
 */
export function OpenInMenu({ folder }: { folder: string }) {
  const icons = useOpenApps((s) => s.icons);
  const programs = useOpenApps((s) => s.programs);
  const loaded = useOpenApps((s) => s.loaded);
  const saved = useFolderSettings((s) => s.byFolder[folder]?.openIn);
  const activeFilePath = useFilesStore((s) => s.activeFilePath);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  useEffect(() => {
    void useOpenApps
      .getState()
      .load()
      .catch(() => undefined);
    void useFolderSettings
      .getState()
      .load(folder)
      .catch(() => undefined);
  }, [folder]);

  const targets = availableTargets(icons, programs);
  const chosen = chosenTarget(targets, saved);

  const open = (target: OpenAppTarget) => {
    setError("");
    void openInTarget(openInPath(target, folder, activeFilePath), target).catch((reason) =>
      setError(`Couldn't open in ${target.label}: ${errorText(reason)}`),
    );
  };
  const pick = (target: OpenAppTarget) => {
    if (target.id !== saved) {
      void useFolderSettings
        .getState()
        .update(folder, { openIn: target.id })
        .catch(() => undefined);
    }
    open(target);
  };
  const add = () => {
    void useOpenApps
      .getState()
      .add()
      .then((program) => {
        if (program) pick({ id: customTargetId(program), label: program.name });
      })
      .catch((reason) => setError(errorText(reason)));
  };

  if (!loaded || !chosen) return <Skeleton className="h-7 w-12" />;

  return (
    <div className="open-app" role="group" aria-label="Open in">
      <IconButton
        label={`Open in ${chosen.label}`}
        className="open-app-main"
        onClick={() => open(chosen)}
      >
        <TargetIcon target={chosen} icon={icons[chosen.id]?.icon} />
      </IconButton>
      <DropdownMenu>
        <MenuTrigger iconOnly chevron label="Open in another app" className="open-app-more" />
        <DropdownMenuContent align="end" className="w-60">
          {targets.map((target) => (
            <MenuItem
              key={target.id}
              icon={
                <span className="open-app-row-icons">
                  {target.id === chosen.id ? (
                    <Check className="size-4" />
                  ) : (
                    <span className="size-4" />
                  )}
                  <TargetIcon target={target} icon={icons[target.id]?.icon} />
                </span>
              }
              label={target.label}
              onSelect={() => pick(target)}
            />
          ))}
          <DropdownMenuSeparator />
          {programs.length ? (
            <MenuSubmenu icon={Trash2} label="Remove a program">
              {programs.map((program) => (
                <MenuItem
                  key={program.id}
                  label={program.name}
                  onSelect={() =>
                    void useOpenApps
                      .getState()
                      .remove(program.id)
                      .catch((reason) => setError(errorText(reason)))
                  }
                />
              ))}
            </MenuSubmenu>
          ) : null}
          <MenuItem icon={Plus} label="Add a program" onSelect={add} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
