// Misty: a motion graphic's props, the values its script draws with that a person can change in
// the properties panel without touching the code ("Day one", the accent color, the number a
// counter reaches). They are kept with the element as JSON: name → { type, value, ... }.

export type MotionPropType = "text" | "color" | "number";

export interface MotionPropDeclaration {
	type: MotionPropType;
	value: string | number;
	/** The field's label; by default the name in words ("accentColor" → "Accent color"). */
	label?: string;
	min?: number;
	max?: number;
	step?: number;
}

export type MotionProps = Record<string, MotionPropDeclaration>;

export const MAX_MOTION_PROPS = 24;
export const MAX_MOTION_PROP_TEXT = 500;
const MAX_LABEL = 40;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const fail = (message: string): never => {
	throw new Error(message);
};

/** #abc as #aabbcc, lowercase, so the color field shows it. */
function normalizeHex(value: string): string {
	const hex = value.slice(1).toLowerCase();
	return hex.length === 3
		? `#${hex
				.split("")
				.map((digit) => digit + digit)
				.join("")}`
		: `#${hex}`;
}

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/** One prop as declared, checked, or an error naming what is wrong with it. */
export function checkMotionProp(name: string, input: unknown): MotionPropDeclaration {
	if (!NAME.test(name)) {
		fail(`"${name.slice(0, 40)}" can't be a prop's name: use letters, digits and _, starting with a letter.`);
	}
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return fail(`Prop ${name} needs a type and a value.`);
	}
	const { type, value, label, min, max, step } = input as Record<string, unknown>;
	const labelled =
		label === undefined
			? {}
			: typeof label === "string" && label.trim() && label.length <= MAX_LABEL
				? { label: label.trim() }
				: fail(`Prop ${name}'s label is text of at most ${MAX_LABEL} characters.`);
	if (type === "text") {
		if (typeof value !== "string") return fail(`Prop ${name} is text, so its value is a string.`);
		if (value.length > MAX_MOTION_PROP_TEXT) {
			return fail(`Prop ${name} can hold at most ${MAX_MOTION_PROP_TEXT} characters.`);
		}
		return { type, value, ...labelled };
	}
	if (type === "color") {
		if (typeof value !== "string" || !HEX.test(value)) {
			return fail(`Prop ${name} is a color, written as #rrggbb.`);
		}
		return { type, value: normalizeHex(value), ...labelled };
	}
	if (type === "number") {
		if (!finite(value)) return fail(`Prop ${name} is a number, so its value is a number.`);
		if (min !== undefined && !finite(min)) return fail(`Prop ${name}'s min is a number.`);
		if (max !== undefined && !finite(max)) return fail(`Prop ${name}'s max is a number.`);
		if (finite(min) && finite(max) && min > max) {
			return fail(`Prop ${name}'s min is above its max.`);
		}
		if (step !== undefined && !(finite(step) && step > 0)) {
			return fail(`Prop ${name}'s step is a number above 0.`);
		}
		const clamped = Math.min(
			finite(max) ? max : Number.POSITIVE_INFINITY,
			Math.max(finite(min) ? min : Number.NEGATIVE_INFINITY, value),
		);
		return {
			type,
			value: clamped,
			...labelled,
			...(finite(min) && { min }),
			...(finite(max) && { max }),
			...(finite(step) && { step }),
		};
	}
	return fail(`Prop ${name}'s type is text, color or number.`);
}

/** A whole set of props as declared, checked. */
export function checkMotionProps(input: unknown): MotionProps {
	if (input === undefined || input === null) return {};
	if (typeof input !== "object" || Array.isArray(input)) {
		return fail("props is an object of name → { type, value }.");
	}
	const entries = Object.entries(input as Record<string, unknown>);
	if (entries.length > MAX_MOTION_PROPS) {
		fail(`A motion graphic can have at most ${MAX_MOTION_PROPS} props.`);
	}
	return Object.fromEntries(entries.map(([name, value]) => [name, checkMotionProp(name, value)]));
}

/** The type a bare value implies: a number, a #rrggbb color, or text. */
function inferredDeclaration(value: unknown): unknown {
	if (typeof value === "number") return { type: "number", value };
	if (typeof value === "string") return { type: HEX.test(value) ? "color" : "text", value };
	return value;
}

/**
 * Props changed by an edit: a declaration ({ type, value, ... }) adds or replaces a prop, a bare
 * value sets an existing prop's value (or adds one of the type it implies), and null removes one.
 */
export function mergeMotionProps(base: MotionProps, changes: unknown): MotionProps {
	if (changes === undefined || changes === null) return base;
	if (typeof changes !== "object" || Array.isArray(changes)) {
		return fail("props is an object of name → value or { type, value }.");
	}
	const next: MotionProps = { ...base };
	for (const [name, change] of Object.entries(changes as Record<string, unknown>)) {
		if (change === null) {
			delete next[name];
			continue;
		}
		const isDeclaration =
			typeof change === "object" && !Array.isArray(change) && "type" in change;
		const existing = next[name];
		next[name] = isDeclaration
			? checkMotionProp(name, change)
			: existing
				? checkMotionProp(name, { ...existing, value: change })
				: checkMotionProp(name, inferredDeclaration(change));
	}
	if (Object.keys(next).length > MAX_MOTION_PROPS) {
		fail(`A motion graphic can have at most ${MAX_MOTION_PROPS} props.`);
	}
	return next;
}

/** The props kept with an element, leaving out any that don't hold up. */
export function readMotionProps(stored: unknown): MotionProps {
	let parsed: unknown = stored;
	if (typeof stored === "string") {
		try {
			parsed = JSON.parse(stored);
		} catch {
			return {};
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const props: MotionProps = {};
	for (const [name, value] of Object.entries(parsed as Record<string, unknown>).slice(
		0,
		MAX_MOTION_PROPS,
	)) {
		try {
			props[name] = checkMotionProp(name, value);
		} catch {
			// A prop that doesn't hold up is left out; the script sees it as undefined.
		}
	}
	return props;
}

export function serializeMotionProps(props: MotionProps): string {
	return JSON.stringify(props);
}

/** What the script's `props` argument holds: each prop's value by name. */
export function motionPropValues(props: MotionProps): Record<string, string | number> {
	return Object.fromEntries(
		Object.entries(props).map(([name, declaration]) => [name, declaration.value]),
	);
}

/** "accentColor" → "Accent color", "lower_third" → "Lower third". */
export function motionPropLabel(name: string, declaration: MotionPropDeclaration): string {
	if (declaration.label) return declaration.label;
	const words = name
		.replace(/_/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}
