import { detectAppFormFactor } from "../../platform/formFactor";
import DesktopProvidersPage from "./desktop";
import MobileProvidersPage from "./mobile";

export default function ProvidersPage() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileProvidersPage />
  ) : (
    <DesktopProvidersPage />
  );
}
