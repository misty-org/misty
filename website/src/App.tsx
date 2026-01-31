import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/NavBar";

export default function App() {
  const location = useLocation();

  // Global scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        
        <main className="flex-1">
          <Outlet />
        </main>

      </div>
    </AuthProvider>
  );
}