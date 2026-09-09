import { useEffect, useState, type ReactNode } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { refreshNavigationNames, useNavigationNames } from "./store";

export function NavigationNamesBoundary({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [scope, setScope] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const reset = () => setGeneration((n) => n + 1);
    window.addEventListener("misty:account-scope-reset", reset);
    return () => window.removeEventListener("misty:account-scope-reset", reset);
  }, []);
  const state = useNavigationNames();
  useEffect(() => {
    let disposed = false;
    setScope("");
    useNavigationNames.setState({ account: "", ready: false, names: {}, error: null });
    void resolveApiBase()
      .then((base) => {
        if (disposed) return;
        const account = JSON.stringify([base.replace(/\/$/, ""), userId]);
        setScope(account);
        useNavigationNames.setState({
          account,
          names: {},
          ready: !hasTauriInternals(),
          error: null,
        });
      })
      .catch((error) => {
        if (!disposed) useNavigationNames.setState({ ready: true, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [userId, generation]);
  useEffect(() => {
    if (!scope || !hasTauriInternals()) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (!active || busy) return;
      busy = true;
      try {
        await refreshNavigationNames(scope);
      } catch (error) {
        if (active) useNavigationNames.setState({ ready: true, error: String(error) });
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [scope]);
  if (!state.ready || (scope && state.account !== scope))
    return (
      <div role="status" className="p-4 text-sm text-cream-muted">
        Loading navigation…
      </div>
    );
  return (
    <>
      {state.error && (
        <div
          role="alert"
          className="fixed bottom-3 left-3 z-[2147483401] max-w-md rounded-md bg-charcoal-card p-3 text-sm text-cream shadow-lg"
        >
          {state.error} Your last valid names are retained. Fix navigation.json to retry.
        </div>
      )}
      {children}
    </>
  );
}
