// Misty: OpenCut's notices (the `sonner` package's `toast`) become Misty's notices. A
// description joins the message after a dash; a running task shows its outcome when it ends,
// since Misty draws no progress inside a notice.
import { notify } from "@/shared/ui";

type ToastOptions = { description?: string; id?: string | number };
type Message = string;

function say(tone: "neutral" | "error", message: Message, options?: ToastOptions) {
	const text = options?.description ? `${message} — ${options.description}` : message;
	return notify({
		message: text,
		tone: tone === "error" ? "error" : undefined,
		id: options?.id === undefined ? undefined : String(options.id),
	}).id;
}

type PromiseMessages<T> = {
	loading?: string;
	success?: string | ((value: T) => string);
	error?: string | ((reason: unknown) => string);
};

export const toast = Object.assign((message: Message, options?: ToastOptions) => say("neutral", message, options), {
	success: (message: Message, options?: ToastOptions) => say("neutral", message, options),
	info: (message: Message, options?: ToastOptions) => say("neutral", message, options),
	warning: (message: Message, options?: ToastOptions) => say("neutral", message, options),
	error: (message: Message, options?: ToastOptions) => say("error", message, options),
	promise<T>(task: Promise<T> | (() => Promise<T>), messages: PromiseMessages<T>) {
		const running = typeof task === "function" ? task() : task;
		running.then(
			(value) => {
				const text =
					typeof messages.success === "function" ? messages.success(value) : messages.success;
				if (text) say("neutral", text);
			},
			(reason: unknown) => {
				const text =
					typeof messages.error === "function" ? messages.error(reason) : messages.error;
				say("error", text ?? (reason instanceof Error ? reason.message : "Something went wrong"));
			},
		);
		return { unwrap: () => running };
	},
});
