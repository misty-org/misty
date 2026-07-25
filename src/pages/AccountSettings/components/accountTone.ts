export type AccountStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export const TIER_LABEL: Record<string, string> = {
  basic: "Free",
  pro: "Pro",
};

export const TIER_TONE: Record<string, AccountStatusTone> = {
  basic: "neutral",
  pro: "info",
};

export const STATUS_TONE: Record<string, AccountStatusTone> = {
  active: "success",
  trialing: "info",
  cancelled: "warning",
  expired: "danger",
};

export const STATUS_CLASSES: Record<AccountStatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-[color-mix(in_srgb,var(--settings-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-info)_12%,transparent)] text-[var(--settings-info)]",
  success:
    "border-[color-mix(in_srgb,var(--settings-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-success)_12%,transparent)] text-[var(--settings-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--settings-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-warning)_12%,transparent)] text-[var(--settings-warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--settings-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--settings-danger)_12%,transparent)] text-[var(--settings-danger)]",
};
