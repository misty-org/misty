import { detectAppFormFactor } from "../../shell/platform";
import DesktopFilesPage from "./desktop";
import MobileFilesPage from "./mobile";

export default function FilesPage() {
  return detectAppFormFactor() === "mobile" ? (
    <MobileFilesPage />
  ) : (
    <DesktopFilesPage />
  );
}
