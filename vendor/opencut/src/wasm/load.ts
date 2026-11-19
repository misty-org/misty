// Misty: OpenCut's Rust core (the `opencut-wasm` package, MIT) for Vite, which doesn't load a
// WebAssembly module as an ES module the way the package's own entry expects. Every import of
// "opencut-wasm" in the editor resolves here (see Misty's .config/vite.config.ts); the module is
// instantiated once, by `loadOpencutWasm`, before the editor opens, and its functions are the
// package's own bindings.
import * as bindings from "opencut-wasm/opencut_wasm_bg.js";
import wasmUrl from "opencut-wasm/opencut_wasm_bg.wasm?url";

export * from "opencut-wasm/opencut_wasm_bg.js";

type WasmExports = WebAssembly.Exports & { __wbindgen_start: () => void };

let loading: Promise<void> | null = null;

/** Instantiates OpenCut's core; later calls wait for the first, or start over after a failure. */
export function loadOpencutWasm(source?: BufferSource): Promise<void> {
	loading ??= (async () => {
		const imports = { "./opencut_wasm_bg.js": bindings as unknown as WebAssembly.ModuleImports };
		const { instance } = source
			? await WebAssembly.instantiate(source, imports)
			: await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
		const exports = instance.exports as WasmExports;
		bindings.__wbg_set_wasm(exports);
		exports.__wbindgen_start();
	})().catch((reason: unknown) => {
		// Misty: a failed load is tried again by the next call, rather than kept for good.
		loading = null;
		throw reason;
	});
	return loading;
}
