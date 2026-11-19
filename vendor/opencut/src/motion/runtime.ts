// Misty: the engine a motion graphic's script runs in. QuickJS compiled to WebAssembly is a
// separate JavaScript engine that sees nothing of the app, the page, the network or files. Its
// only way out is measuring text. The engine loads once (loadMotionRuntime, awaited before the
// first frame of anything that has a motion graphic); after that a frame is drawn synchronously,
// as the renderer needs. Each script is compiled once into an engine of its own, with a memory
// limit and a time limit per frame, and kept while it is in use.
import {
	newQuickJSWASMModuleFromVariant,
	newVariant,
	type QuickJSContext,
	type QuickJSHandle,
	type QuickJSRuntime,
	type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import releaseVariant from "@jitl/quickjs-wasmfile-release-sync";
import wasmLocation from "@jitl/quickjs-wasmfile-release-sync/wasm?url";
import { sanitizeMotionCommands, type MotionCommand } from "./commands";
import {
	COMPILE_TIME_LIMIT_MS,
	FRAME_TIME_LIMIT_MS,
	MAX_SCRIPT_CHARS,
	MEMORY_LIMIT_BYTES,
	STACK_LIMIT_BYTES,
	fontPixelSize,
	isSafeFont,
} from "./limits";
import {
	MOTION_SCRIPT_FILE,
	MOTION_SCRIPT_LINE_OFFSET,
	buildMotionPrelude,
	wrapMotionScript,
} from "./prelude";

export interface MotionFrameInput {
	script: string;
	/** The props' values, by name. */
	props: Record<string, string | number>;
	/** Seconds since the graphic starts. */
	time: number;
	/** The graphic's length in seconds. */
	duration: number;
	width: number;
	height: number;
}

export type MotionFrameResult =
	| { ok: true; commands: MotionCommand[] }
	| { ok: false; error: string };

interface Program {
	runtime: QuickJSRuntime;
	vm: QuickJSContext;
	frame: QuickJSHandle;
	clock: { deadline: number };
}

type Compiled = { ok: true; program: Program } | { ok: false; error: string };

const MAX_PROGRAMS = 16;
const DEFAULT_FONT = "10px sans-serif";

let wasm = wasmLocation;
let engine: QuickJSWASMModule | null = null;
let loading: Promise<QuickJSWASMModule> | null = null;
let prelude: string | null = null;
const programs = new Map<string, Compiled>();

/** Tests run outside the app, where the bundler's URL for the engine is not a file: they name the file. */
export function setMotionWasm(location: string): void {
	clearMotionPrograms();
	wasm = location;
	engine = null;
	loading = null;
}

/** Loads the engine, once. Resolves at once when it is already loaded. */
export function loadMotionRuntime(): Promise<void> {
	if (engine) return Promise.resolve();
	loading ??= newQuickJSWASMModuleFromVariant(
		newVariant(releaseVariant, { wasmLocation: wasm }),
	).then(
		(module) => {
			engine = module;
			return module;
		},
		(error: unknown) => {
			loading = null;
			throw error;
		},
	);
	return loading.then(() => undefined);
}

export function isMotionRuntimeReady(): boolean {
	return engine !== null;
}

/** Lets every compiled script go, as when the editor closes. */
export function clearMotionPrograms(): void {
	for (const compiled of programs.values()) {
		if (compiled.ok) disposeProgram(compiled.program);
	}
	programs.clear();
}

/** Why a script can't be drawn, or null when it compiles and defines draw. */
export function checkMotionScript(script: string): string | null {
	if (!engine) return "The motion graphic engine hasn't loaded yet.";
	const compiled = programFor(engine, script);
	return compiled.ok ? null : compiled.error;
}

/** One frame of a script, as checked drawing calls. Needs loadMotionRuntime to have finished. */
export function runMotionFrame(input: MotionFrameInput): MotionFrameResult {
	if (!engine) return { ok: false, error: "The motion graphic engine hasn't loaded yet." };
	const compiled = programFor(engine, input.script);
	if (!compiled.ok) return compiled;
	const { vm, clock, frame } = compiled.program;
	clock.deadline = Date.now() + FRAME_TIME_LIMIT_MS;
	let text: string;
	try {
		const args = [
			vm.newNumber(input.time),
			vm.newString(JSON.stringify(input.props)),
			vm.newNumber(input.width),
			vm.newNumber(input.height),
			vm.newNumber(input.duration),
		];
		const result = vm.callFunction(frame, vm.undefined, ...args);
		for (const arg of args) arg.dispose();
		if (result.error) {
			const error = describeError(vm, result.error, clock, "frame", input.script);
			result.error.dispose();
			// An engine that ran out of memory starts afresh on the next frame.
			if (error.includes("memory")) dropProgram(input.script);
			return { ok: false, error };
		}
		text = vm.getString(result.value);
		result.value.dispose();
	} catch (error) {
		dropProgram(input.script);
		return {
			ok: false,
			error: error instanceof Error ? error.message : "The script couldn't draw this frame.",
		};
	}
	let raw: unknown = null;
	try {
		raw = JSON.parse(text);
	} catch {
		raw = null;
	}
	return sanitizeMotionCommands(raw);
}

/**
 * The first error a script hits over its length (its start, quarters and end), or null. Agents'
 * edits use it to refuse a graphic that wouldn't draw.
 */
export function testMotionScript(
	input: Omit<MotionFrameInput, "time">,
): string | null {
	const compileError = checkMotionScript(input.script);
	if (compileError) return compileError;
	const last = Math.max(0, input.duration - 1 / 30);
	const moments = [0, 0.25, 0.5, 0.75].map((share) => share * input.duration).concat(last);
	for (const time of moments) {
		const result = runMotionFrame({ ...input, time });
		if (!result.ok) return `At ${Math.round(time * 100) / 100} s: ${result.error}`;
	}
	return null;
}

function programFor(module: QuickJSWASMModule, script: string): Compiled {
	const cached = programs.get(script);
	if (cached) {
		programs.delete(script);
		programs.set(script, cached);
		return cached;
	}
	const compiled = compileProgram(module, script);
	programs.set(script, compiled);
	while (programs.size > MAX_PROGRAMS) {
		const oldest = programs.keys().next().value;
		if (oldest === undefined) break;
		dropProgram(oldest);
	}
	return compiled;
}

function dropProgram(script: string): void {
	const compiled = programs.get(script);
	programs.delete(script);
	if (compiled?.ok) disposeProgram(compiled.program);
}

function disposeProgram(program: Program): void {
	try {
		program.frame.dispose();
		program.vm.dispose();
		program.runtime.dispose();
	} catch {
		// An engine that broke is let go however far its disposal got.
	}
}

function compileProgram(module: QuickJSWASMModule, script: string): Compiled {
	if (script.length > MAX_SCRIPT_CHARS) {
		return {
			ok: false,
			error: `The script is ${script.length} characters long; a motion graphic's script can be at most ${MAX_SCRIPT_CHARS}.`,
		};
	}
	const runtime = module.newRuntime();
	runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
	runtime.setMaxStackSize(STACK_LIMIT_BYTES);
	const clock = { deadline: Date.now() + COMPILE_TIME_LIMIT_MS };
	runtime.setInterruptHandler(() => Date.now() > clock.deadline);
	const vm = runtime.newContext();
	const release = () => {
		try {
			vm.dispose();
			runtime.dispose();
		} catch {
			// As in disposeProgram.
		}
	};
	try {
		const measure = vm.newFunction("__measure", (font, text) =>
			vm.newString(JSON.stringify(measureText(vm.getString(font), vm.getString(text)))),
		);
		vm.setProp(vm.global, "__measure", measure);
		measure.dispose();
		prelude ??= buildMotionPrelude();
		const steps: Array<[string, string]> = [
			[prelude, "prelude.js"],
			[wrapMotionScript(script), MOTION_SCRIPT_FILE],
			["__lockdown(); __check();", "check.js"],
		];
		for (const [code, file] of steps) {
			const result = vm.evalCode(code, file);
			if (result.error) {
				const error = describeError(vm, result.error, clock, "compile", script);
				result.error.dispose();
				release();
				return { ok: false, error };
			}
			result.value.dispose();
		}
		const frame = vm.getProp(vm.global, "__frame");
		return { ok: true, program: { runtime, vm, frame, clock } };
	} catch (error) {
		release();
		return {
			ok: false,
			error: error instanceof Error ? error.message : "The script couldn't be loaded.",
		};
	}
}

function describeError(
	vm: QuickJSContext,
	handle: QuickJSHandle,
	clock: { deadline: number },
	phase: "compile" | "frame",
	script: string,
): string {
	// Reading the error runs in the engine too, so it gets a moment past a deadline that passed.
	clock.deadline = Date.now() + FRAME_TIME_LIMIT_MS;
	const dumped = vm.dump(handle) as
		| { name?: string; message?: string; stack?: string }
		| string
		| null;
	if (!dumped || typeof dumped !== "object") {
		return `The script threw ${String(dumped).slice(0, 300)}`;
	}
	const name = dumped.name ?? "Error";
	const message = (dumped.message ?? "").slice(0, 500);
	if (name === "InternalError" && /interrupted/i.test(message)) {
		return phase === "compile"
			? `The script took longer than ${COMPILE_TIME_LIMIT_MS} ms to load.`
			: `The script took longer than ${FRAME_TIME_LIMIT_MS} ms to draw a frame.`;
	}
	if (/out of memory/i.test(message)) {
		return `The script used more than ${MEMORY_LIMIT_BYTES / 1024 / 1024} MB of memory.`;
	}
	const line = scriptLine(dumped.stack ?? "", script);
	return `${name}: ${message}${line ? ` (line ${line})` : ""}`;
}

/** The line of the script an error points at, counted from the script's own first line. */
function scriptLine(stack: string, script: string): number | null {
	const match = new RegExp(`${MOTION_SCRIPT_FILE.replace(".", "\\.")}:(\\d+)`).exec(stack);
	if (!match) return null;
	const line = Number(match[1]) - MOTION_SCRIPT_LINE_OFFSET;
	const lines = script.split("\n").length;
	return line >= 1 && line <= lines ? line : null;
}

let measurer: OffscreenCanvasRenderingContext2D | null | undefined;

/** Text metrics for the script's measureText, in the order the recorder reads them. */
function measureText(font: string, text: string): number[] {
	const safeFont = isSafeFont(font) ? font : DEFAULT_FONT;
	if (measurer === undefined) {
		try {
			measurer =
				typeof OffscreenCanvas === "undefined"
					? null
					: new OffscreenCanvas(1, 1).getContext("2d");
		} catch {
			measurer = null;
		}
	}
	if (!measurer) {
		// Outside a browser (tests): an estimate in proportion to the font's size.
		const size = fontPixelSize(safeFont) ?? 10;
		const width = text.length * size * 0.56;
		return [width, 0, width, size * 0.72, size * 0.2, size * 0.92, size * 0.24];
	}
	measurer.font = safeFont;
	const metrics = measurer.measureText(text);
	return [
		metrics.width,
		metrics.actualBoundingBoxLeft,
		metrics.actualBoundingBoxRight,
		metrics.actualBoundingBoxAscent,
		metrics.actualBoundingBoxDescent,
		metrics.fontBoundingBoxAscent,
		metrics.fontBoundingBoxDescent,
	].map((value) => (Number.isFinite(value) ? value : 0));
}
