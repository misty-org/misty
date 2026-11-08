// The omnibox's public surface, for other features that rank and open
// matches the way the address bar does (the search popup).
export { createOmniboxProviders } from "./pages/omnibox/providers";
export { liveOmniboxDeps, warmOmniboxCaches } from "./pages/omnibox/liveDeps";
export { useOmniboxAutocomplete } from "./pages/omnibox/useOmniboxAutocomplete";
export { omniboxMatchIcon } from "./pages/omnibox/matchIcon";
export type { OmniboxInput, OmniboxMatch } from "./pages/omnibox/omniboxTypes";
