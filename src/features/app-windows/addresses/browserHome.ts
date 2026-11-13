import { blankBrowserUrl } from "./browserUrl";

/**
 * Where an agent's page starts when nothing else asked for a URL: a blank page. Agents search with
 * Google once they know what to look for; a page of its own choosing would only be noise.
 */
export function browserHomeUrl(): string {
  return blankBrowserUrl;
}
