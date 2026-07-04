import { detectAppFormFactor } from "../../platform/formFactor";
import DesktopAccountPage from "./desktop";
import MobileAccountPage from "./mobile";

export default function AccountPage() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileAccountPage />
  ) : (
    <DesktopAccountPage />
  );
}
