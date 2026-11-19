// Misty: types for the generated bindings module that load.ts imports directly. They are the
// same functions the package's own entry (opencut_wasm.d.ts) declares, plus the setter that
// hands the bindings their instantiated module.
declare module "opencut-wasm/opencut_wasm_bg.js" {
	export * from "opencut-wasm";
	export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
