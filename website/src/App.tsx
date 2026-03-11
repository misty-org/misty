import { useEffect } from "react";
import { Outlet, useMatches, ScrollRestoration } from "react-router";
import { AuthProvider } from "./AuthContext";
import Navbar from "./components/NavBar";

type Handle = { title: string }


export default function App() {
  const matches = useMatches();

  useEffect(() => {
    const match = [...matches].reverse().find((m) => (m.handle as Handle)?.title);
    console.log(match?.handle)
    document.title = (match?.handle as any)?.title
  }, [matches]);

  return (
    <AuthProvider>
      <ScrollRestoration />

      <div className="min-h-screen flex flex-col">
        <Navbar />
        
        <main className="flex-1">
          <Outlet />
        </main>

      </div>
    </AuthProvider>
  );
}