// The omnibox's public surface, for other features that rank and open
// matches the way the address bar does (the search popup).
export { createOmniboxProviders } from "./workspace/omnibox/providers";
export { searchSuggestProvider } from "./workspace/omnibox/providers/searchSuggest";
export { liveOmniboxDeps } from "./workspace/omnibox/liveDeps";
export { useOmniboxAutocomplete } from "./workspace/omnibox/useOmniboxAutocomplete";
export { omniboxMatchIcon } from "./workspace/omnibox/OmniboxRow";
export type { OmniboxInput, OmniboxMatch } from "./workspace/omnibox/types";
