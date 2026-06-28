import ReactDOM from "react-dom/client";
import { installClientDebugging } from "./shared/debug/clientDebug";

installClientDebugging();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

void bootstrap();

async function bootstrap() {
  const [{ App }] = await Promise.all([
    import("./App"),
    import("./styles.css"),
  ]);
  root.render(<App />);
}
