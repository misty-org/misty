// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState, type ReactNode } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  type SettingsContentProps,
} from "@/features/settings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, cn, Skeleton, SkeletonControl, useNotice } from "@/shared/ui";
import { DropdownControl, SwitchControl } from "../settings/SettingsControls";
import type { PetSummary } from "./petAtlas";
import { normalizePetScale, PET_SCALE_OPTIONS } from "./petScale";
import { petErrorMessage, petsApi, petSettingsEvent } from "./petsApi";
import { listen } from "@tauri-apps/api/event";

/** The cache entry for this device's pets and choices. */
const PETS_KEY = "pets/list";

/**
 * This device's pets and choices, read again whenever native code says they changed. The last
 * list is kept on this computer, so the section paints at once and refreshes behind it.
 */
function usePets() {
  const listing = useCachedResource(PETS_KEY, () => petsApi.list(), { persist: "device" });
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const [busy, setBusy] = useState(false);

  const { reload } = listing;
  // A failed read keeps what is shown; the failure is the notice beside it.
  const loadError = listing.error;
  useEffect(() => {
    if (loadError) setError(petErrorMessage(loadError));
  }, [loadError]);

  useEffect(() => {
    // Outside the desktop app (a browser preview, tests) there are no native events to hear.
    if (!hasTauriInternals()) return;
    const unlisten = listen(petSettingsEvent, () => void reload());
    return () => void unlisten.then((dispose) => dispose()).catch(() => undefined);
  }, [reload]);

  /** Runs one change, showing what went wrong and reading the truth back afterwards. */
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      setError("");
    } catch (failure) {
      setError(petErrorMessage(failure));
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return {
    pets: listing.data?.pets ?? null,
    settings: listing.data?.settings ?? null,
    busy,
    act,
  };
}

/**
 * One placeholder settings row, in DesktopSettingsRow's grid, ending in `children`. The first row
 * names what is loading for screen readers, as the panel insets only its direct rows.
 */
function SkeletonRow(props: { width: string; status?: boolean; children: ReactNode }) {
  return (
    // An empty label keeps the panel's padding and hairlines without naming a setting.
    <div
      data-setting-label=""
      role={props.status ? "status" : undefined}
      aria-label={props.status ? "Pet" : undefined}
      aria-busy={props.status || undefined}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 py-3"
    >
      <div className="flex h-6 items-center">
        <Skeleton className={cn("h-4", props.width)} />
      </div>
      <div className="flex items-center justify-end gap-2">{props.children}</div>
    </div>
  );
}

/** The section's three rows on a first load: the switch, the pet menu with Import, and size. */
function PetsSkeleton() {
  return (
    <>
      <SkeletonRow width="w-20" status>
        <SkeletonControl kind="switch" />
      </SkeletonRow>
      <SkeletonRow width="w-10">
        <SkeletonControl kind="select" className="w-50" />
        <SkeletonControl kind="button" />
      </SkeletonRow>
      <SkeletonRow width="w-10">
        <SkeletonControl kind="select" className="w-50" />
      </SkeletonRow>
    </>
  );
}

/**
 * Settings for the desktop pet: show it, pick or import one, and its size. A pet is a Codex v2
 * package (a folder with `pet.json` and its spritesheet) and follows what the person's agents do.
 */
export function PetsSection(_props: SettingsContentProps) {
  const { pets, settings, busy, act } = usePets();
  if (!hasTauriInternals()) return null;
  if (!pets || !settings) {
    return (
      <Section title="Pet">
        <PetsSkeleton />
      </Section>
    );
  }
  const selected = pets.find((pet) => pet.id === settings.petId);
  const importPet = () =>
    act(async () => {
      const imported = await petsApi.importPet();
      if (imported && !settings.enabled) await petsApi.setVisible(true);
    });
  const removePet = async (pet: PetSummary) => {
    if (!(await confirmAction(`Remove “${pet.displayName}” from this computer?`, "Remove pet")))
      return;
    await act(() => petsApi.remove(pet.id));
  };
  return (
    <Section title="Pet">
      <Row label="Show pet">
        <SwitchControl
          checked={settings.enabled && Boolean(selected)}
          disabled={busy || !selected}
          onChange={(visible) => void act(() => petsApi.setVisible(visible))}
        />
      </Row>
      <Row label="Pet">
        <div className="flex items-center gap-2">
          {pets.length ? (
            <DropdownControl
              label="Pet"
              value={selected?.id ?? ""}
              disabled={busy}
              options={pets.map((pet) => ({ value: pet.id, label: pet.displayName }))}
              onValueChange={(id) => void act(() => petsApi.select(id))}
            />
          ) : null}
          <Button disabled={busy} onClick={() => void importPet()}>
            Import
          </Button>
          {selected ? (
            <Button variant="quiet" disabled={busy} onClick={() => void removePet(selected)}>
              Remove
            </Button>
          ) : null}
        </div>
      </Row>
      <Row label="Size" muted={!selected}>
        <DropdownControl
          label="Size"
          value={String(normalizePetScale(settings.scale))}
          disabled={busy || !selected}
          options={PET_SCALE_OPTIONS.map((value) => ({
            value: String(value),
            label: `${value * 100}%`,
          }))}
          onValueChange={(value) => void act(() => petsApi.setScale(Number(value)))}
        />
      </Row>
    </Section>
  );
}
