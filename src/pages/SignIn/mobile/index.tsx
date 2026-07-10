import { Navigate } from "react-router-dom";

export function MobileSignInPage() {
  return <Navigate to="/account/signin" replace />;
}

export default MobileSignInPage;
