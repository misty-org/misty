import { useSpacesStore as spacesStore } from "./list/useSpacesStore";

// Keep this as an owned public binding instead of a transitive re-export.
// The store is shared by lazy route chunks; Rollup otherwise creates a
// circular chunk edge between the shell and those routes.
export const useSpacesStore = spacesStore;
