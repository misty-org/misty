import { Navigate } from "react-router-dom";

/** Keep old misty://extensions links working through the dedicated workspace. */
export function ExtensionsPage() {
  return <Navigate to="/extensions" replace />;
}
