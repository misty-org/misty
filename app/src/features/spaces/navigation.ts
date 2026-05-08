const validSpaceSections = new Set(["chat", "planner", "notes", "drawings", "library"]);

export function spaceDestination(pathname: string, spaceId: string): string {
  const encodedSpaceId = encodeURIComponent(spaceId);
  const base = `/spaces/${encodedSpaceId}`;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces") return base;

  const requestedSection = parts[2] === "files" ? "library" : parts[2];
  return requestedSection && validSpaceSections.has(requestedSection)
    ? `${base}/${requestedSection}`
    : base;
}
