import { AppRouter } from "./router";
import { DesktopWindowReady } from "./layouts/DesktopWindowReady";

export function App() {
  return (
    <>
      <DesktopWindowReady />
      <AppRouter />
    </>
  );
}
