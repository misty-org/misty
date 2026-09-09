import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import { NativeAppView } from "../src/features/apps/NativeAppView";
import "../src/styles/styles.css";

// Development-only host for the native example. It never opens an account.
function Workflow() {
  const params = new URLSearchParams(location.search);
  const [generation, setGeneration] = useState(0);
  const [geometry, setGeometry] = useState("");
  const measure = async () => {
    const view = document.querySelector("[data-misty-native-app]")?.lastElementChild;
    const rect = view?.getBoundingClientRect();
    const native = await invoke("workflow_geometry");
    setGeometry(JSON.stringify({ client: rect?.toJSON(), native }));
  };
  const title = params.get("title") ?? "Storage Report";
  const source = params.get("source") ?? "";
  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#181818",
        color: "#eee",
      }}
    >
      <header style={{ padding: "40px 12px 12px" }}>
        <strong>{title} native workflow test</strong>
        <output
          style={{ position: "absolute", left: 0, bottom: 0, fontSize: 8, pointerEvents: "none" }}
        >
          {geometry}
        </output>
        <p>Test folder: {params.get("folder")}</p>
        <button onClick={() => setGeneration((value) => value + 1)}>
          Close and reopen test app
        </button>
        <button style={{ marginLeft: 16 }} onClick={() => void measure()}>
          Inspect native layout
        </button>
      </header>
      <section style={{ flex: 1, minHeight: 0 }}>
        <NativeAppView
          key={generation}
          source={source}
          title={title}
          context={{}}
          onRequest={async () => {
            throw new Error("Legacy commands are unavailable in this test.");
          }}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Workflow />);
