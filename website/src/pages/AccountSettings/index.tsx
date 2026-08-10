export { AccountSettingsDialog } from "./AccountSettingsDialog";

// The legacy route is intentionally empty. App converts /settings into the
// same modal over the home page so old bookmarks still work without a page.
export default function SettingsRoute() {
  return null;
}
