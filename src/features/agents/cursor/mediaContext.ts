/** What a playing video was saying, as a request can carry it to the run. */
export interface MediaContext {
  title: string;
  url: string;
  /** Seconds into the video. */
  time: number;
  duration?: number | null;
  paused: boolean;
  /** Lines said from about 90 seconds before `time`, each with its start in seconds. */
  transcript: { t: number; text: string }[];
}
