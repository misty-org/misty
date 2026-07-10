import { lazy, Suspense } from "react";
import { detectAppFormFactor } from "../../platform/formFactor";
import MobileFilesPage from "./mobile";

const DesktopFilesPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));

export default function FilesPage() {
  if (detectAppFormFactor() === "mobile" || !DesktopFilesPage) return <MobileFilesPage />;
  return (
    <Suspense fallback={null}>
      <DesktopFilesPage />
    </Suspense>
  );
}
