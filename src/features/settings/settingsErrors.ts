import { definitionById } from "./profiles/registry";

/** Plain-language page notice for a settings failure; raw server and setting keys never reach the UI. */
export function settingsErrorMessage(error: string): string {
  const id = /setting[^"]*"([\w.]+)"/i.exec(error)?.[1];
  const label = id ? definitionById.get(id)?.label : undefined;
  if (label) return `Couldn't save “${label}”. Your other settings are safe.`;
  if (/could not apply/i.test(error)) return "Some settings couldn't be applied on this device.";
  if (/still loading/i.test(error)) return "Settings are still syncing with your account.";
  return "Couldn't sync your settings with your account.";
}
