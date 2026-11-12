// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
  type SettingsContentProps,
} from "@/features/settings";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ErrorNotification, SkeletonList } from "@/shared/ui";
import { DropdownControl, SwitchControl } from "../settings/SettingsControls";
import type { PetSummary } from "./petAtlas";
import { normalizePetScale, PET_SCALE_OPTIONS } from "./petScale";
import { petErrorMessage, petsApi, petSettingsEvent, type PetSettings } from "./petsApi";
import { listen } from "@tauri-apps/api/event";

/** This device's pets and choices, read again whenever native code says they changed. */
function usePets() {
  const [pets, setPets] = useState<PetSummary[] | null>(null);
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      petsApi
        .list()
        .then((result) => {
          setPets(result.pets);
          setSettings(result.settings);
        })
        .catch((failure: unknown) => {
          setPets((known) => known ?? []);
          setError(petErrorMessage(failure));
        }),
    [],
  );

  useEffect(() => {
    void reload();
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

  return { pets, settings, error, setError, busy, act };
}

/**
 * Settings for the desktop pet: show it, pick or import one, and its size. A pet is a Codex v2
 * package (a folder with `pet.json` and its spritesheet) and follows what the person's agents do.
 */
export function PetsSection(_props: SettingsContentProps) {
  const { pets, settings, error, setError, busy, act } = usePets();
  if (!hasTauriInternals()) return null;
  if (!pets || !settings) {
    return (
      <Section title="Pet">
        <SkeletonList label="Pet" rows={3} leading="none" lines={1} trailing />
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
      {error ? <ErrorNotification message={error} onDismiss={() => setError("")} /> : null}
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
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void importPet()}>
            Import
          </Button>
          {selected ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void removePet(selected)}
            >
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
