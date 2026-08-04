import { lazy, Suspense } from "react";

const DesktopExtensionsPage = lazy(() => import("./desktop"));

export default function ExtensionsPage(props: { embedded?: boolean }) {
  return (
    <Suspense fallback={null}>
      <DesktopExtensionsPage {...props} />
    </Suspense>
  );
}
