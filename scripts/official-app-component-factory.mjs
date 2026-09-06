/**
 * A module import is cached by the WebView. Evaluate the bundled application
 * inside each mount instead, so its stores belong to that mount, not the account
 * that happened to import it first. No eval, global SDK or nonce imports needed.
 */
export const componentFrameworkGlobals = {
  react: "MistyComponentLibraries.react",
  "react-dom": "MistyComponentLibraries.reactDom",
  "react-dom/client": "MistyComponentLibraries.reactDomClient",
  "react/jsx-runtime": "MistyComponentLibraries.jsxRuntime",
  "react/jsx-dev-runtime": "MistyComponentLibraries.jsxDevRuntime",
  yjs: "MistyComponentLibraries.yjs",
};
export function officialAppComponentFactory(appId, { framework = false, runtime = false } = {}) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(appId)) throw new Error("Invalid component app ID.");
  return {
    name: "misty-component-instance-factory",
    generateBundle(options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      if (options.format !== "iife" || options.name !== "MistyComponentBundle" ||
          chunks.length !== 1 || chunks[0].imports.some(id => !framework || !Object.hasOwn(componentFrameworkGlobals, id)) || chunks[0].dynamicImports.length) {
        this.error("Component packages must contain one self-contained MistyComponentBundle IIFE.");
      }
      const chunk = chunks[0];
      const needsYjs = chunk.imports.includes("yjs");
      chunk.code = `export default Object.freeze({
        appId: ${JSON.stringify(appId)}, protocol: 2,
        mount(input) {
          ${runtime ? `const lifetime = new AbortController();
          const abortRuntime = () => lifetime.abort();
          input.signal?.addEventListener("abort", abortRuntime, {once:true});
          if (input.signal?.aborted) abortRuntime();
          const releaseRuntime = () => { lifetime.abort(); input.signal?.removeEventListener("abort", abortRuntime); };
          const MistyComponentRuntime = Object.freeze({sdk:input.misty, signal:lifetime.signal});
          try {
          if (lifetime.signal.aborted) throw new Error("The downloaded App view is closed.");` : ""}
          ${framework ? `const MistyComponentLibraries = input.libraries;
          if (!MistyComponentLibraries?.react?.version?.startsWith("19.") ||
              !MistyComponentLibraries.reactDomClient?.createRoot) {
            throw new Error("This App requires Misty's React 19 component runtime.");
          }` : ""}
          ${needsYjs ? `if (typeof MistyComponentLibraries.yjs?.Doc !== "function" ||
              typeof MistyComponentLibraries.yjs?.applyUpdate !== "function") {
            throw new Error("This App requires Misty's Yjs 13 component runtime.");
          }` : ""}
          ${chunk.code}
          const definition = MistyComponentBundle;
          if (definition?.appId !== ${JSON.stringify(appId)} || definition.protocol !== 2 ||
              typeof definition.mount !== "function") {
            throw new Error("The downloaded App has an incompatible component export.");
          }
          ${runtime ? `return Promise.resolve(definition.mount(input)).then(mounted => ({
            update: mounted.update.bind(mounted),
            async unmount() { try { await mounted.unmount(); } finally { releaseRuntime(); } }
          }), error => { releaseRuntime(); throw error; });
          } catch (error) { releaseRuntime(); throw error; }` : "return definition.mount(input);"}
        }
      });`;
    },
  };
}
