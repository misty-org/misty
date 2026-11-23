// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  IconButton,
  LogoInitial,
  MenuItem,
  MenuSubmenu,
  MenuTrigger,
  Skeleton,
  SplitButton,
  useNotice,
} from "@misty/ui";
import { useFolderSettings } from "../folders/folder_settings";
import { useFilesStore } from "../files/files_store";
import { isWithinDirectory } from "../files/repository_selection";
import {
  availableTargets,
  chosenTarget,
  customTargetId,
  openInTarget,
  useOpenApps,
  type OpenAppTarget,
} from "./open_app";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function TargetIcon({ target, icon }: { target: OpenAppTarget; icon?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (icon && broken !== icon)
    return (
      <img
        src={icon}
        alt=""
        aria-hidden="true"
        className="size-4 flex-none object-contain"
        onError={() => setBroken(icon)}
      />
    );
  return <LogoInitial name={target.label} />;
}

function openInPath(target: OpenAppTarget, folder: string, activeFilePath: string | null): string {
  if (target.id === "finder") return folder;
  return activeFilePath && isWithinDirectory(folder, activeFilePath) ? activeFilePath : folder;
}

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

  if (!loaded || !chosen) return <Skeleton className="h-8 w-12.5 shrink-0 rounded-md" />;

  return (
    <SplitButton label="Open in">
      <IconButton label={`Open in ${chosen.label}`} onClick={() => open(chosen)}>
        <TargetIcon target={chosen} icon={icons[chosen.id]?.icon} />
      </IconButton>
      <DropdownMenu>
        <MenuTrigger iconOnly chevron label="Open in another app" />
        <DropdownMenuContent align="end" className="w-60">
          {targets.map((target) => (
            <MenuItem
              key={target.id}
              icon={
                <span className="inline-flex flex-none items-center gap-2">
                  {target.id === chosen.id ? <Check /> : <span className="size-4" />}
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
    </SplitButton>
  );
}
