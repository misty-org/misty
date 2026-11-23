// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
export const PET_BASE_SCALE = 0.6;

export const PET_SCALE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export const DEFAULT_PET_SCALE = 1;

export function normalizePetScale(value: number | undefined): number {
  const target = value ?? DEFAULT_PET_SCALE;
  return PET_SCALE_OPTIONS.reduce<number>(
    (closest, candidate) =>
      Math.abs(candidate - target) < Math.abs(closest - target) ? candidate : closest,
    DEFAULT_PET_SCALE,
  );
}
