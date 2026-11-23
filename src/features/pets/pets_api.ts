// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import type { PetPackage, PetStatus, PetSummary } from "./pet_atlas";
import type { PetActivity } from "./pet_state";

export interface PetSettings {
  enabled: boolean;
  petId: string;
  scale: number;
  position: { x: number; y: number } | null;
}

export interface NativePetState {
  sessionKey: string | null;
  sessionName: string | null;
  status: PetStatus;
  activity: PetActivity;
  lookDirection: number;
  cursorNearby: boolean;
  cursorOver: boolean;
  changedAt: number;
}

export const petStateEvent = "misty://pet-state";
export const petScaleEvent = "misty://pet-scale";
export const petSettingsEvent = "misty://pet-settings-changed";

export const petsApi = {
  list: () => invoke<{ pets: PetSummary[]; settings: PetSettings }>("pet_list"),
  settings: () => invoke<PetSettings>("pet_settings"),
  getPackage: (id: string) => invoke<PetPackage>("pet_get_package", { id }),
  importPet: () => invoke<PetSummary | null>("pet_import"),
  remove: (id: string) => invoke<void>("pet_remove", { id }),
  select: (id: string) => invoke<PetSettings>("pet_select", { id }),
  setVisible: (visible: boolean) => invoke<void>("pet_set_visible", { visible }),
  setScale: (scale: number) => invoke<number>("pet_set_scale", { scale }),
  setState: (next: {
    sessionKey: string | null;
    sessionName: string | null;
    status: PetStatus;
    activity: PetActivity;
    changedAt: number;
  }) => invoke<void>("pet_set_state", { next }),
  overlayState: () => invoke<NativePetState>("pet_overlay_state"),
  savePosition: (position: { x: number; y: number }) =>
    invoke<void>("pet_save_position", { position }),
};

export function petErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() || "Something went wrong with the pet.";
}
