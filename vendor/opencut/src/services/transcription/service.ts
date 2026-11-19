// Misty: OpenCut transcribes with Whisper, downloaded into the page and run in a worker. In
// Misty speech is the computer's own: the app hands this service a transcriber
// (`setTranscriber`) that sends the audio to the system's speech recognizer, and the captions
// panel offers to generate captions only while one is set.
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionResult,
} from "@opencut/transcription/types";

type ProgressCallback = (progress: TranscriptionProgress) => void;

/** Turns recorded speech into text with each segment's start and end, in seconds. */
export type Transcriber = (input: {
	audio: Blob;
	language?: Exclude<TranscriptionLanguage, "auto">;
}) => Promise<TranscriptionResult>;

let transcriber: Transcriber | null = null;
const listeners = new Set<() => void>();

/** Sets (or, with null, removes) how speech becomes text. */
export function setTranscriber(next: Transcriber | null): void {
	transcriber = next;
	for (const listener of listeners) listener();
}

/** Whether this computer can transcribe speech now. */
export function canTranscribe(): boolean {
	return transcriber !== null;
}

/** Calls back whenever transcription becomes available or unavailable. */
export function onTranscriberChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

class TranscriptionService {
	async transcribe({
		audioBlob,
		language,
		onProgress,
	}: {
		audioBlob: Blob;
		language?: TranscriptionLanguage;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		if (!transcriber) throw new Error("Speech recognition isn't available on this computer.");
		onProgress?.({ status: "transcribing", progress: 0 });
		const result = await transcriber({
			audio: audioBlob,
			language: language === "auto" ? undefined : language,
		});
		onProgress?.({ status: "complete", progress: 100 });
		return result;
	}
}

export const transcriptionService = new TranscriptionService();
