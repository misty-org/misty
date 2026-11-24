import type { SpaceIntegrationAccess } from "../api/dto/entities";

export type AccessChoice = "read" | "write";

export const accessChoices: ReadonlyArray<{ value: AccessChoice; label: string }> = [
  { value: "read", label: "Read" },
  { value: "write", label: "Read and write" },
];

export function accessFor(choice: AccessChoice): SpaceIntegrationAccess[] {
  return choice === "write" ? ["rooms.read", "rooms.write"] : ["rooms.read"];
}

export function accessLine(
  access: readonly SpaceIntegrationAccess[] | undefined,
  keyPrefix?: string | null,
): string {
  if (!access?.length) return "";
  const writes = access.includes("rooms.write");
  const reads = access.includes("rooms.read");
  const what = writes && reads ? "Reads and writes" : writes ? "Writes" : "Reads";
  const prefix = keyPrefix?.trim();
  return prefix ? `${what} rooms starting with ${prefix}` : `${what} rooms`;
}
