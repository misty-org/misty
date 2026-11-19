// Misty: the starter motion graphics on the Text tab, and the presets agents name in a
// `graphic` edit. Each is only a script and its props, the same as one an agent writes, so a
// person can open it in the properties panel and change it. Sizes follow the frame's shorter
// side (u = 1 at 1080), so they look the same in any frame.
import type { MotionProps } from "./props";

export interface MotionPreset {
	id: string;
	name: string;
	script: string;
	props: MotionProps;
	/** The moment the Text tab's card shows, for a graphic of `previewDuration` seconds. */
	previewTime: number;
	previewDuration: number;
}

const title: MotionPreset = {
	id: "title",
	name: "Animated title",
	previewTime: 2,
	previewDuration: 4,
	props: {
		title: { type: "text", value: "Day one" },
		subtitle: { type: "text", value: "A new chapter begins" },
		color: { type: "color", value: "#ffffff" },
		accent: { type: "color", value: "#ffb224" },
		size: { type: "number", value: 150, min: 40, max: 320, step: 1, label: "Title size" },
	},
	script: String.raw`// Animated title: the letters rise into place one after another from behind a line, an accent
// bar draws out under them and the subtitle follows. All of it lifts away at the end.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const span = (t, start, length) => clamp((t - start) / length, 0, 1);
const easeOut = (x) => 1 - Math.pow(1 - x, 4);
const easeInOut = (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2);
const FONT = "Inter, system-ui, sans-serif";

function draw(ctx, t, props, { width, height, duration }) {
	const u = Math.min(width, height) / 1080;
	const leave = easeInOut(span(t, duration - 0.6, 0.6));
	const fade = 1 - leave;
	if (fade <= 0) return;

	const size = props.size * u;
	ctx.translate(width / 2, height / 2 - size * 0.25 - 40 * u * leave);

	ctx.font = "800 " + size + "px " + FONT;
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	const title = String(props.title);
	const letters = Array.from(title);
	const full = ctx.measureText(title).width;
	const baseline = size * 0.36;

	ctx.save();
	ctx.beginPath();
	ctx.rect(-full / 2 - size, baseline - size * 1.25, full + size * 2, size * 1.53);
	ctx.clip();
	ctx.fillStyle = props.color;
	let before = "";
	letters.forEach((letter, index) => {
		const x = -full / 2 + ctx.measureText(before).width;
		before += letter;
		const p = easeOut(span(t, 0.1 + index * 0.045, 0.75));
		if (p <= 0) return;
		ctx.globalAlpha = fade * Math.min(1, p * 1.5);
		ctx.fillText(letter, x, baseline + (1 - p) * size * 1.1);
	});
	ctx.restore();

	const settle = 0.3 + letters.length * 0.045;
	const bar = easeOut(span(t, settle, 0.8));
	const barWidth = Math.max(full * 0.3, 140 * u) * bar;
	const barHeight = Math.max(3, 9 * u);
	const barY = baseline + size * 0.3;
	if (barWidth > 0.5) {
		ctx.globalAlpha = fade;
		ctx.fillStyle = props.accent;
		ctx.beginPath();
		ctx.roundRect(-barWidth / 2, barY, barWidth, barHeight, barHeight / 2);
		ctx.fill();
	}

	const subtitle = String(props.subtitle);
	if (subtitle) {
		const subSize = size * 0.27;
		const p = easeOut(span(t, settle + 0.2, 0.8));
		ctx.font = "500 " + subSize + "px " + FONT;
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.globalAlpha = fade * p * 0.8;
		ctx.fillStyle = props.color;
		ctx.fillText(subtitle, 0, barY + barHeight + subSize * 0.8 + (1 - p) * subSize * 0.7);
	}
}
`,
};

const lowerThird: MotionPreset = {
	id: "lower_third",
	name: "Lower third",
	previewTime: 2.5,
	previewDuration: 5,
	props: {
		name: { type: "text", value: "Alex Rivera" },
		role: { type: "text", value: "Product designer" },
		accent: { type: "color", value: "#ff5a36" },
		panel: { type: "color", value: "#121216" },
		color: { type: "color", value: "#ffffff", label: "Text color" },
	},
	script: String.raw`// Lower third: an accent bar grows from its middle, a panel slides out from behind it with the
// name and role, and at the end everything folds back into the bar.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const span = (t, start, length) => clamp((t - start) / length, 0, 1);
const easeOut = (x) => 1 - Math.pow(1 - x, 4);
const easeIn = (x) => x * x * x;
const FONT = "Inter, system-ui, sans-serif";

function draw(ctx, t, props, { width, height, duration }) {
	const u = Math.min(width, height) / 1080;
	const out = duration - 0.75;
	const bar = easeOut(span(t, 0, 0.45)) * (1 - easeIn(span(t, out + 0.45, 0.3)));
	const open = easeOut(span(t, 0.25, 0.65)) * (1 - easeIn(span(t, out + 0.1, 0.4)));
	if (bar <= 0) return;

	const name = String(props.name);
	const role = String(props.role);
	const nameSize = 52 * u;
	const roleSize = 30 * u;
	ctx.font = "700 " + nameSize + "px " + FONT;
	const nameWidth = ctx.measureText(name).width;
	ctx.font = "500 " + roleSize + "px " + FONT;
	const roleWidth = ctx.measureText(role).width;

	const padX = 34 * u;
	const padY = 24 * u;
	const gap = 10 * u;
	const barWidth = 10 * u;
	const panelWidth = Math.max(nameWidth, roleWidth) + padX * 2;
	const panelHeight = padY * 2 + nameSize + gap + (role ? roleSize : -gap);
	const left = Math.max(width * 0.06, 48 * u);
	const top = height - Math.max(height * 0.1, 96 * u) - panelHeight;

	const barHeight = panelHeight * bar;
	ctx.fillStyle = props.accent;
	ctx.fillRect(left, top + (panelHeight - barHeight) / 2, barWidth, barHeight);
	if (open <= 0) return;

	ctx.save();
	ctx.beginPath();
	ctx.rect(left + barWidth, top, panelWidth * open + 1, panelHeight);
	ctx.clip();
	ctx.translate(left + barWidth - panelWidth * (1 - open), top);
	ctx.globalAlpha = 0.94;
	ctx.fillStyle = props.panel;
	ctx.beginPath();
	ctx.roundRect(0, 0, panelWidth, panelHeight, [0, 8 * u, 8 * u, 0]);
	ctx.fill();

	const nameIn = easeOut(span(t, 0.5, 0.6)) * (1 - easeIn(span(t, out, 0.3)));
	const roleIn = easeOut(span(t, 0.62, 0.6)) * (1 - easeIn(span(t, out - 0.05, 0.3)));
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	ctx.fillStyle = props.color;
	ctx.font = "700 " + nameSize + "px " + FONT;
	ctx.globalAlpha = nameIn;
	ctx.fillText(name, padX - 28 * u * (1 - nameIn), padY);
	if (role) {
		ctx.font = "500 " + roleSize + "px " + FONT;
		ctx.globalAlpha = roleIn * 0.7;
		ctx.fillText(role, padX - 28 * u * (1 - roleIn), padY + nameSize + gap);
	}
	ctx.restore();
}
`,
};

const counter: MotionPreset = {
	id: "counter",
	name: "Counter",
	previewTime: 2.6,
	previewDuration: 4,
	props: {
		value: { type: "number", value: 10000, min: -1000000000, max: 1000000000, step: 1, label: "Count to" },
		prefix: { type: "text", value: "" },
		suffix: { type: "text", value: "+" },
		label: { type: "text", value: "Subscribers" },
		decimals: { type: "number", value: 0, min: 0, max: 3, step: 1 },
		countSeconds: { type: "number", value: 1.8, min: 0.2, max: 20, step: 0.1, label: "Count length" },
		color: { type: "color", value: "#ffffff" },
		accent: { type: "color", value: "#38bdf8" },
	},
	script: String.raw`// Counter: counts up to a number, slowing as it gets there, over a line that fills with it, and
// gives a small pop when it lands. Every digit sits in a slot of the same width, so the number
// doesn't wobble as it counts.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const span = (t, start, length) => clamp((t - start) / length, 0, 1);
const easeOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const FONT = "Inter, system-ui, sans-serif";

function group(digits) {
	let out = "";
	for (let i = 0; i < digits.length; i++) {
		if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
		out += digits[i];
	}
	return out;
}

function format(value, decimals) {
	const parts = Math.abs(value).toFixed(decimals).split(".");
	return (value < 0 ? "-" : "") + group(parts[0]) + (parts[1] ? "." + parts[1] : "");
}

const isDigit = (ch) => ch >= "0" && ch <= "9";

function draw(ctx, t, props, { width, height, duration }) {
	const u = Math.min(width, height) / 1080;
	const enter = easeOut(span(t, 0, 0.5));
	const alpha = enter * (1 - easeIn(span(t, duration - 0.45, 0.45)));
	if (alpha <= 0) return;

	const decimals = clamp(Math.round(props.decimals), 0, 3);
	const length = Math.max(0.2, props.countSeconds);
	const progress = easeOutExpo(span(t, 0.15, length));
	const prefix = String(props.prefix);
	const suffix = String(props.suffix);
	const text = prefix + format(props.value * progress, decimals) + suffix;
	const finalText = prefix + format(props.value, decimals) + suffix;

	const size = 150 * u;
	ctx.font = "800 " + size + "px " + FONT;
	let slot = 0;
	for (let digit = 0; digit <= 9; digit++) slot = Math.max(slot, ctx.measureText(String(digit)).width);
	const widthOf = (ch) => (isDigit(ch) ? slot : ctx.measureText(ch).width);
	const chars = Array.from(text);
	const widths = chars.map(widthOf);
	const total = widths.reduce((sum, each) => sum + each, 0);
	const finalWidth = Array.from(finalText).map(widthOf).reduce((sum, each) => sum + each, 0);

	const middle = height / 2 - size * 0.2;
	const landed = span(t, 0.15 + length * 0.9, 0.35);
	const pop = 1 + 0.05 * Math.sin(Math.PI * landed);

	ctx.save();
	ctx.translate(width / 2, middle);
	ctx.scale(pop, pop);
	ctx.globalAlpha = alpha;
	ctx.fillStyle = props.color;
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	let x = -total / 2;
	chars.forEach((ch, index) => {
		ctx.fillText(ch, x + widths[index] / 2, size * 0.36 + (1 - enter) * 30 * u);
		x += widths[index];
	});
	ctx.restore();

	const barWidth = Math.max(finalWidth, 320 * u);
	const barHeight = Math.max(3, 8 * u);
	const barY = middle + size * 0.36 + 44 * u;
	const barLeft = width / 2 - barWidth / 2;
	ctx.globalAlpha = alpha * 0.18;
	ctx.fillStyle = props.color;
	ctx.beginPath();
	ctx.roundRect(barLeft, barY, barWidth, barHeight, barHeight / 2);
	ctx.fill();
	if (progress > 0) {
		ctx.globalAlpha = alpha;
		ctx.fillStyle = props.accent;
		ctx.beginPath();
		ctx.roundRect(barLeft, barY, Math.max(barHeight, barWidth * progress), barHeight, barHeight / 2);
		ctx.fill();
	}

	const label = String(props.label).toUpperCase();
	if (label) {
		const labelSize = 32 * u;
		const tracking = labelSize * 0.22;
		ctx.font = "600 " + labelSize + "px " + FONT;
		const letters = Array.from(label);
		const letterWidths = letters.map((ch) => ctx.measureText(ch).width);
		const labelWidth =
			letterWidths.reduce((sum, each) => sum + each, 0) + tracking * (letters.length - 1);
		const labelIn = easeOut(span(t, 0.35, 0.7));
		ctx.globalAlpha = alpha * labelIn * 0.75;
		ctx.fillStyle = props.color;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		let lx = width / 2 - labelWidth / 2;
		letters.forEach((ch, index) => {
			ctx.fillText(ch, lx, barY + barHeight + 30 * u + (1 - labelIn) * 16 * u);
			lx += letterWidths[index] + tracking;
		});
	}
}
`,
};

const progressBar: MotionPreset = {
	id: "progress_bar",
	name: "Progress bar",
	previewTime: 2.6,
	previewDuration: 5,
	props: {
		color: { type: "color", value: "#ffffff", label: "Fill" },
		track: { type: "color", value: "#ffffff" },
		thickness: { type: "number", value: 10, min: 2, max: 60, step: 1 },
		margin: { type: "number", value: 48, min: 0, max: 400, step: 1, label: "Edge margin" },
	},
	script: String.raw`// Progress bar: a line along the bottom of the frame that fills over the graphic's whole length,
// with a soft glow at its head. Stretch the graphic over the part of the video it measures.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const span = (t, start, length) => clamp((t - start) / length, 0, 1);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;

function draw(ctx, t, props, { width, height, duration }) {
	const u = Math.min(width, height) / 1080;
	const appear = easeOut(span(t, 0, 0.35)) * (1 - easeIn(span(t, duration - 0.35, 0.35)));
	if (appear <= 0) return;

	const progress = clamp(t / Math.max(0.001, duration), 0, 1);
	const thickness = Math.max(1, props.thickness * u);
	const margin = props.margin * u;
	const left = margin;
	const length = width - margin * 2;
	const y = height - margin - thickness;
	const radius = thickness / 2;

	ctx.globalAlpha = appear * 0.22;
	ctx.fillStyle = props.track;
	ctx.beginPath();
	ctx.roundRect(left, y, length, thickness, radius);
	ctx.fill();

	const filled = Math.max(thickness, length * progress);
	ctx.globalAlpha = appear;
	ctx.fillStyle = props.color;
	ctx.beginPath();
	ctx.roundRect(left, y, filled, thickness, radius);
	ctx.fill();

	const headX = left + filled - radius;
	const headY = y + radius;
	const reach = thickness * 3.2;
	const glow = ctx.createRadialGradient(headX, headY, 0, headX, headY, reach);
	glow.addColorStop(0, props.color);
	glow.addColorStop(1, props.color + "00");
	ctx.globalAlpha = appear * 0.5;
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(headX, headY, reach, 0, Math.PI * 2);
	ctx.fill();
}
`,
};

const subscribe: MotionPreset = {
	id: "subscribe",
	name: "Subscribe button",
	previewTime: 2.1,
	previewDuration: 4,
	props: {
		label: { type: "text", value: "Subscribe" },
		doneLabel: { type: "text", value: "Subscribed", label: "After the click" },
		color: { type: "color", value: "#ff0033", label: "Button" },
		textColor: { type: "color", value: "#ffffff" },
	},
	script: String.raw`// Subscribe button: the button pops up, a pointer glides over and clicks it, and it turns into
// "Subscribed" with a ringing bell. It shrinks away at the end.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const span = (t, start, length) => clamp((t - start) / length, 0, 1);
const mix = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const FONT = "Inter, system-ui, sans-serif";
const CLICK = 1.35;
const DONE_COLOR = "#2b2b30";

function channels(hex) {
	return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) || 0);
}

function mixColor(from, to, k) {
	const a = channels(from);
	const b = channels(to);
	return "rgb(" + a.map((value, i) => Math.round(mix(value, b[i], k))).join(", ") + ")";
}

function bell(ctx, size) {
	const s = size;
	ctx.beginPath();
	ctx.moveTo(-s * 0.46, s * 0.26);
	ctx.lineTo(-s * 0.34, s * 0.1);
	ctx.bezierCurveTo(-s * 0.36, -s * 0.42, s * 0.36, -s * 0.42, s * 0.34, s * 0.1);
	ctx.lineTo(s * 0.46, s * 0.26);
	ctx.closePath();
	ctx.fill();
	ctx.beginPath();
	ctx.arc(0, s * 0.36, s * 0.1, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(0, -s * 0.33, s * 0.07, 0, Math.PI * 2);
	ctx.fill();
}

function pointer(ctx, x, y, size) {
	const c = size;
	ctx.save();
	ctx.translate(x, y);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(0, c);
	ctx.lineTo(c * 0.26, c * 0.76);
	ctx.lineTo(c * 0.44, c * 1.14);
	ctx.lineTo(c * 0.6, c * 1.07);
	ctx.lineTo(c * 0.42, c * 0.7);
	ctx.lineTo(c * 0.74, c * 0.7);
	ctx.closePath();
	ctx.fillStyle = "#ffffff";
	ctx.fill();
	ctx.lineWidth = Math.max(1, c * 0.06);
	ctx.lineJoin = "round";
	ctx.strokeStyle = "#111111";
	ctx.stroke();
	ctx.restore();
}

function draw(ctx, t, props, { width, height, duration }) {
	const u = Math.min(width, height) / 1080;
	const appear = span(t, 0, 0.55);
	const leave = easeInOut(span(t, duration - 0.4, 0.4));
	if (appear <= 0 || leave >= 1) return;
	const alpha = Math.min(1, appear * 2) * (1 - leave);

	const cx = width / 2;
	const cy = height * 0.8;
	const done = easeOut(span(t, CLICK, 0.3));
	const press = Math.sin(Math.PI * span(t, CLICK - 0.08, 0.22));
	const scale = backOut(appear) * (1 - 0.06 * press) * (1 - 0.3 * leave);

	const label = String(props.label);
	const doneLabel = String(props.doneLabel);
	const h = 84 * u;
	const fontSize = 34 * u;
	const padX = 42 * u;
	const icon = 30 * u;
	const gap = 14 * u;
	ctx.font = "700 " + fontSize + "px " + FONT;
	const before = ctx.measureText(label).width + padX * 2;
	const after = ctx.measureText(doneLabel).width + padX * 2 + icon + gap;
	const w = mix(before, after, done);

	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(scale, scale);
	ctx.globalAlpha = alpha;
	ctx.fillStyle = mixColor(props.color, DONE_COLOR, done);
	ctx.beginPath();
	ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
	ctx.fill();

	ctx.fillStyle = props.textColor;
	ctx.textBaseline = "middle";
	if (done < 1) {
		ctx.globalAlpha = alpha * (1 - done);
		ctx.textAlign = "center";
		ctx.fillText(label, 0, -done * 12 * u);
	}
	if (done > 0) {
		const startX = -(after - padX * 2) / 2;
		ctx.globalAlpha = alpha * done;
		ctx.textAlign = "left";
		ctx.fillText(doneLabel, startX + icon + gap, (1 - done) * 12 * u);
		const ring = span(t, CLICK + 0.1, 1.1);
		ctx.save();
		ctx.translate(startX + icon / 2, -icon * 0.4);
		ctx.rotate(Math.sin(ring * Math.PI * 6) * (1 - ring) * 0.5);
		ctx.translate(0, icon * 0.4);
		bell(ctx, icon);
		ctx.restore();
	}
	ctx.restore();

	const targetX = cx + before * 0.18;
	const targetY = cy + h * 0.08;
	const travel = easeInOut(span(t, 0.45, CLICK - 0.45));
	const away = easeInOut(span(t, CLICK + 0.45, 0.6));
	const x = mix(targetX + 260 * u, targetX, travel) + 170 * u * away;
	const y = mix(targetY + 230 * u, targetY, travel) + 150 * u * away;

	const ripple = span(t, CLICK, 0.6);
	if (ripple > 0 && ripple < 1) {
		ctx.globalAlpha = (1 - ripple) * 0.5 * (1 - leave);
		ctx.strokeStyle = props.textColor;
		ctx.lineWidth = 3 * u;
		ctx.beginPath();
		ctx.arc(targetX, targetY, 18 * u + ripple * 70 * u, 0, Math.PI * 2);
		ctx.stroke();
	}

	const pointerAlpha = span(t, 0.45, 0.25) * (1 - away) * (1 - leave);
	if (pointerAlpha > 0) {
		ctx.globalAlpha = pointerAlpha;
		pointer(ctx, x, y, 46 * u * (1 - 0.12 * press));
	}
}
`,
};

export const MOTION_PRESETS: readonly MotionPreset[] = [
	title,
	lowerThird,
	counter,
	progressBar,
	subscribe,
];

export const MOTION_PRESET_IDS = MOTION_PRESETS.map((preset) => preset.id);

export function getMotionPreset(id: string): MotionPreset | undefined {
	return MOTION_PRESETS.find((preset) => preset.id === id);
}
