import * as react from "react";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as yjs from "yjs";
import type { MistyComponentLibraries } from "@misty/sdk";

// A single renderer avoids accumulating per-bundle document event listeners.
// Share Yjs constructors too: separate bundled copies break instanceof checks.
// Never add documents, Host contexts, authenticated stores or native adapters here.
export const componentLibraries: MistyComponentLibraries = Object.freeze({
  react,
  reactDom,
  reactDomClient,
  jsxRuntime,
  jsxDevRuntime,
  yjs,
});
