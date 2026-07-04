import { detectAppFormFactor } from "../../platform/formFactor";
import DesktopSettingsPage from "./desktop";
import MobileSettingsPage from "./mobile";

export default function SettingsPage() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileSettingsPage />
  ) : (
    <DesktopSettingsPage />
  );
}
