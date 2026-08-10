// design-sync stub for @/stores/app
//
// The application store is not part of the portable design system — pulling it
// into the bundle would drag the entire app-state layer (backend, transfers,
// providers, …) along with it. Design previews have no app context, so this
// stub hands store-reading UI components an empty snapshot: selectors run
// against `{}` and return undefined instead of crashing, which lets those
// components render their no-context fallback (e.g. AssetIcon → lucide icons).
export function useAppStore<T>(selector: (state: unknown) => T): T {
  return selector({});
}
