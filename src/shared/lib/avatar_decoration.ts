export type AvatarDecoration = { outline?: string };

const hexColor = /^#[0-9a-f]{6}$/i;

export function readAvatarDecoration(value: unknown): AvatarDecoration {
  if (!value || typeof value !== "object") return {};
  const outline = (value as { outline?: unknown }).outline;
  return typeof outline === "string" && hexColor.test(outline) ? { outline } : {};
}

export function avatarOutline(value: unknown): string | undefined {
  return readAvatarDecoration(value).outline;
}
