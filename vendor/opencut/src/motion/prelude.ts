// Misty: what runs inside a motion graphic's sandbox before its script. It gives the script a
// stand-in for a canvas 2D context that only records what is drawn, as a list of plain calls
// the host checks and replays (commands.ts). Each frame calls the script afresh, Math.random is
// seeded from the frame's time and the global objects are frozen, so a frame looks the same
// whenever and in whatever order it is drawn: in the preview, in an export, or for an agent.
import {
	FONT_PATTERN,
	MAX_COMMANDS,
	MAX_DASH_SEGMENTS,
	MAX_FONT_CHARS,
	MAX_FRAME_TEXT_CHARS,
	MAX_GRADIENT_STOPS,
	MAX_GRADIENTS,
	MAX_MEASURES,
	MAX_SAVE_DEPTH,
	MAX_TEXT_CHARS,
} from "./limits";

export const MOTION_SCRIPT_FILE = "graphic.js";

export const NO_DRAW_MESSAGE =
	"The script must define function draw(ctx, t, props), which paints one frame.";

/** Lines the wrapper puts before the script, to count script lines from in errors. */
export const MOTION_SCRIPT_LINE_OFFSET = 1;

/**
 * The script as a function that runs it and hands back its `draw`, so each frame starts from
 * the script's own top-level values rather than whatever the last frame left in them.
 */
export function wrapMotionScript(script: string): string {
	return `globalThis.__make = function () { "use strict";\n${script}\n;return typeof draw === "function" ? draw : undefined; };`;
}

export function buildMotionPrelude(): string {
	return `"use strict";
(function () {
	var g = globalThis;
	var measureHost = g.__measure;
	delete g.__measure;
	var FONT = new RegExp(${JSON.stringify(FONT_PATTERN.source)});
	var NO_DRAW = ${JSON.stringify(NO_DRAW_MESSAGE)};
	var list, chars, gradients, measures, state, stack, ids, seed = 1;

	Math.random = function () {
		seed = (seed + 0x6d2b79f5) | 0;
		var x = seed;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};

	function initial() {
		return {
			fillStyle: "#000000", strokeStyle: "#000000", globalAlpha: 1, lineWidth: 1,
			lineCap: "butt", lineJoin: "miter", miterLimit: 10, lineDashOffset: 0,
			font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", dash: []
		};
	}
	function copy(from) {
		var to = {};
		for (var key in from) to[key] = from[key];
		to.dash = from.dash.slice();
		return to;
	}
	function reset() {
		list = []; chars = 0; gradients = 0; measures = 0;
		state = initial(); stack = []; ids = new WeakMap();
	}
	function rec(command) {
		if (list.length >= ${MAX_COMMANDS}) {
			throw new RangeError("A frame can make at most ${MAX_COMMANDS} drawing calls; draw fewer shapes.");
		}
		list.push(command);
	}
	function n(value) { return +value; }
	function text(value) {
		var s = String(value);
		if (s.length > ${MAX_TEXT_CHARS}) throw new RangeError("Text drawn in one call can be at most ${MAX_TEXT_CHARS} characters.");
		chars += s.length;
		if (chars > ${MAX_FRAME_TEXT_CHARS}) throw new RangeError("A frame can draw at most ${MAX_FRAME_TEXT_CHARS} characters of text.");
		return s;
	}
	function paint(value) {
		if (value !== null && typeof value === "object" && ids.has(value)) return ids.get(value);
		return String(value);
	}
	function gradient(kind, args) {
		if (gradients >= ${MAX_GRADIENTS}) throw new RangeError("A frame can make at most ${MAX_GRADIENTS} gradients.");
		var id = gradients++;
		var stops = 0;
		rec([kind, id].concat(args.map(n)));
		var made = Object.freeze({
			addColorStop: function (offset, color) {
				if (++stops > ${MAX_GRADIENT_STOPS}) throw new RangeError("A gradient can have at most ${MAX_GRADIENT_STOPS} color stops.");
				rec(["colorStop", id, n(offset), String(color)]);
			}
		});
		ids.set(made, id);
		return made;
	}
	function oneOf(key, options) {
		return function (value) {
			value = String(value);
			if (options.indexOf(value) < 0) return;
			state[key] = value;
			rec([key, value]);
		};
	}
	function unavailable(name) {
		return function () {
			throw new TypeError("ctx." + name + " isn't available in a motion graphic.");
		};
	}
	function pathFill(name) {
		return function (rule) { rec(rule === "evenodd" ? [name, "evenodd"] : [name]); };
	}
	function numbers(name, count) {
		return function () {
			var command = [name];
			for (var i = 0; i < count; i++) command.push(n(arguments[i]));
			rec(command);
		};
	}
	function drawText(name) {
		return function (s, x, y, maxWidth) {
			var command = [name, text(s), n(x), n(y)];
			if (maxWidth !== undefined) command.push(n(maxWidth));
			rec(command);
		};
	}

	function makeContext(width, height) {
		var ctx = {};
		var methods = {
			beginPath: function () { rec(["beginPath"]); },
			closePath: function () { rec(["closePath"]); },
			moveTo: numbers("moveTo", 2),
			lineTo: numbers("lineTo", 2),
			quadraticCurveTo: numbers("quadraticCurveTo", 4),
			bezierCurveTo: numbers("bezierCurveTo", 6),
			arcTo: numbers("arcTo", 5),
			rect: numbers("rect", 4),
			arc: function (x, y, r, a0, a1, ccw) { rec(["arc", n(x), n(y), n(r), n(a0), n(a1), !!ccw]); },
			ellipse: function (x, y, rx, ry, rotation, a0, a1, ccw) {
				rec(["ellipse", n(x), n(y), n(rx), n(ry), n(rotation), n(a0), n(a1), !!ccw]);
			},
			roundRect: function (x, y, w, h, radii) {
				var r = radii === undefined ? 0 : Array.isArray(radii) ? radii.slice(0, 4).map(n) : n(radii);
				rec(["roundRect", n(x), n(y), n(w), n(h), r]);
			},
			fill: pathFill("fill"),
			stroke: function () { rec(["stroke"]); },
			clip: pathFill("clip"),
			fillRect: numbers("fillRect", 4),
			strokeRect: numbers("strokeRect", 4),
			clearRect: numbers("clearRect", 4),
			fillText: drawText("fillText"),
			strokeText: drawText("strokeText"),
			measureText: function (s) {
				if (++measures > ${MAX_MEASURES}) throw new RangeError("A frame can measure text at most ${MAX_MEASURES} times.");
				var m = JSON.parse(measureHost(state.font, String(s).slice(0, ${MAX_TEXT_CHARS})));
				return Object.freeze({
					width: m[0], actualBoundingBoxLeft: m[1], actualBoundingBoxRight: m[2],
					actualBoundingBoxAscent: m[3], actualBoundingBoxDescent: m[4],
					fontBoundingBoxAscent: m[5], fontBoundingBoxDescent: m[6]
				});
			},
			save: function () {
				if (stack.length >= ${MAX_SAVE_DEPTH}) throw new RangeError("save() can be nested at most ${MAX_SAVE_DEPTH} deep.");
				stack.push(copy(state));
				rec(["save"]);
			},
			restore: function () {
				if (!stack.length) return;
				state = stack.pop();
				rec(["restore"]);
			},
			translate: numbers("translate", 2),
			rotate: numbers("rotate", 1),
			scale: numbers("scale", 2),
			transform: numbers("transform", 6),
			setTransform: function () {
				if (arguments.length === 0) rec(["resetTransform"]);
				else numbers("setTransform", 6).apply(null, arguments);
			},
			resetTransform: function () { rec(["resetTransform"]); },
			setLineDash: function (segments) {
				if (!Array.isArray(segments)) return;
				var dash = segments.slice(0, ${MAX_DASH_SEGMENTS}).map(n);
				state.dash = dash;
				rec(["setLineDash", dash]);
			},
			getLineDash: function () { return state.dash.slice(); },
			createLinearGradient: function (x0, y0, x1, y1) { return gradient("linearGradient", [x0, y0, x1, y1]); },
			createRadialGradient: function (x0, y0, r0, x1, y1, r1) {
				return gradient("radialGradient", [x0, y0, r0, x1, y1, r1]);
			},
			drawImage: unavailable("drawImage"),
			getImageData: unavailable("getImageData"),
			putImageData: unavailable("putImageData"),
			createImageData: unavailable("createImageData"),
			createPattern: unavailable("createPattern"),
			createConicGradient: unavailable("createConicGradient")
		};
		var setters = {
			fillStyle: function (value) { state.fillStyle = value; rec(["fillStyle", paint(value)]); },
			strokeStyle: function (value) { state.strokeStyle = value; rec(["strokeStyle", paint(value)]); },
			globalAlpha: function (value) {
				value = n(value);
				if (!(value >= 0 && value <= 1)) return;
				state.globalAlpha = value;
				rec(["globalAlpha", value]);
			},
			lineWidth: function (value) {
				value = n(value);
				if (!(value > 0 && isFinite(value))) return;
				state.lineWidth = value;
				rec(["lineWidth", value]);
			},
			miterLimit: function (value) {
				value = n(value);
				if (!(value > 0 && isFinite(value))) return;
				state.miterLimit = value;
				rec(["miterLimit", value]);
			},
			lineDashOffset: function (value) {
				value = n(value);
				if (!isFinite(value)) return;
				state.lineDashOffset = value;
				rec(["lineDashOffset", value]);
			},
			font: function (value) {
				value = String(value);
				if (value.length > ${MAX_FONT_CHARS} || !FONT.test(value)) return;
				state.font = value;
				rec(["font", value]);
			},
			lineCap: oneOf("lineCap", ["butt", "round", "square"]),
			lineJoin: oneOf("lineJoin", ["round", "bevel", "miter"]),
			textAlign: oneOf("textAlign", ["left", "right", "center", "start", "end"]),
			textBaseline: oneOf("textBaseline", ["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"])
		};
		Object.keys(methods).forEach(function (key) {
			Object.defineProperty(ctx, key, { value: methods[key], enumerable: true });
		});
		Object.keys(setters).forEach(function (key) {
			Object.defineProperty(ctx, key, {
				get: function () { return state[key]; },
				set: setters[key],
				enumerable: true
			});
		});
		["shadowBlur", "shadowColor", "shadowOffsetX", "shadowOffsetY", "filter",
			"globalCompositeOperation", "imageSmoothingEnabled", "imageSmoothingQuality"].forEach(function (key) {
			Object.defineProperty(ctx, key, { get: function () { return undefined; }, set: unavailable(key) });
		});
		Object.defineProperty(ctx, "canvas", { value: Object.freeze({ width: width, height: height }), enumerable: true });
		return Object.freeze(ctx);
	}

	Object.defineProperty(g, "__check", {
		value: function () {
			if (typeof g.__make() !== "function") throw new TypeError(NO_DRAW);
		}
	});
	Object.defineProperty(g, "__frame", {
		value: function (t, propsJson, width, height, duration) {
			reset();
			seed = (Math.round(t * 1000) * 2654435761 + 1) | 0;
			var draw = g.__make();
			if (typeof draw !== "function") throw new TypeError(NO_DRAW);
			var props = Object.freeze(JSON.parse(propsJson));
			draw(makeContext(width, height), t, props, Object.freeze({ width: width, height: height, duration: duration }));
			return JSON.stringify(list);
		}
	});
	Object.defineProperty(g, "__lockdown", {
		value: function () {
			try { delete g.Date; } catch (error) { g.Date = undefined; }
			var names = Object.getOwnPropertyNames(g);
			for (var i = 0; i < names.length; i++) {
				var value = g[names[i]];
				if (value && (typeof value === "object" || typeof value === "function")) {
					Object.freeze(value);
					if (value.prototype && typeof value.prototype === "object") Object.freeze(value.prototype);
				}
			}
			Object.freeze(g);
		}
	});
})();
`;
}
