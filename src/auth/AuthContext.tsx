/* eslint-disable react-refresh/only-export-components */
import {
  AuthProvider as WebsiteAuthProvider,
  useAuth,
} from "../pages/Website/AuthContext";
import { useSetupStore } from "../stores/useSetupStore";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);

  return (
    <WebsiteAuthProvider onLogout={() => signOut()}>
      {children}
    </WebsiteAuthProvider>
  );
}

export { useAuth };
