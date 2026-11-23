import { parseSetupDeepLink } from "./server_address";
import { openSetupLink } from "./setup_link_store";

export function openSetupDeepLink(rawUrl: string): void {
  const link = parseSetupDeepLink(rawUrl);
  if (link) openSetupLink(link);
}
