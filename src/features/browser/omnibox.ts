// The omnibox's public surface, for other features that rank and open
// matches the way the address bar does (the search popup).
export { createOmniboxProviders } from "./workspace/omnibox/providers";
export { liveOmniboxDeps, warmOmniboxCaches } from "./workspace/omnibox/liveDeps";
export { useOmniboxAutocomplete } from "./workspace/omnibox/useOmniboxAutocomplete";
export { omniboxMatchIcon } from "./workspace/omnibox/matchIcon";
export type { OmniboxInput, OmniboxMatch } from "./workspace/omnibox/types";
