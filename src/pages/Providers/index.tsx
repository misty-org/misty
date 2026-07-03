import { detectAppFormFactor } from "../../shell/platform";
import DesktopProvidersPage from "./desktop";
import MobileProvidersPage from "./mobile";

export default function ProvidersPage() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileProvidersPage />
  ) : (
    <DesktopProvidersPage />
  );
}
