import { Navigate } from "react-router-dom";

export function MobileHomePage() {
  return <Navigate to="/files" replace />;
}

export default MobileHomePage;
