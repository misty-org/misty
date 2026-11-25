// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
  type SettingsContentProps,
} from "@/features/settings";
import { confirmAction } from "@/shared/lib/confirm_action";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorState, useNotice } from "@misty/ui";
import { DropdownControl, SwitchControl } from "../settings/SettingsControls";
import type { PetSummary } from "./pet_atlas";
import { normalizePetScale, PET_SCALE_OPTIONS } from "./pet_scale";
import { petErrorMessage, petsApi, petSettingsEvent } from "./pets_api";
import { listen } from "@tauri-apps/api/event";

const PETS_KEY = "pets/list";

function usePets() {
  const listing = useCachedResource(PETS_KEY, () => petsApi.list(), { persist: "device" });
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const [busy, setBusy] = useState(false);

  const { reload } = listing;
  const shown = listing.data !== undefined;
  const refreshError = shown ? listing.error : undefined;
  useEffect(() => {
    if (refreshError) setError(petErrorMessage(refreshError));
  }, [refreshError]);
  const loadError =
    !shown && !listing.loading && listing.error ? petErrorMessage(listing.error) : null;

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const unlisten = listen(petSettingsEvent, () => void reload());
    return () => void unlisten.then((dispose) => dispose()).catch(() => undefined);
  }, [reload]);

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
    loadError,
    retry: () => void reload(),
  };
}

export function PetsSection(_props: SettingsContentProps) {
  const { pets, settings, busy, act, loadError, retry } = usePets();
  if (!hasTauriInternals()) return null;
  if (loadError)
    return (
      <ErrorState
        inline
        title="Couldn't read your pets"
        line={loadError}
        action={{ label: "Try again", onClick: retry }}
      />
    );
  if (!pets || !settings)
    return <DesktopSettingsRowSkeleton label="Pet" rows={3} control={["select", "button"]} />;
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
    <>
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
    </>
  );
}
