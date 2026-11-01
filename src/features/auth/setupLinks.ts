import { parseSetupDeepLink } from "./setup/serverAddress";
import { openSetupLink } from "./setup/setupLinkStore";

/**
 * `misty://setup?server=<host>&key=<key>` from the website's setup page opens the wizard on
 * Misty Cloud with both fields filled in. A link whose server isn't https or whose key isn't a
 * setup key is ignored. The key is never logged.
 */
export function openSetupDeepLink(rawUrl: string): void {
  const link = parseSetupDeepLink(rawUrl);
  if (link) openSetupLink(link);
}
