/*
 * Footage analysis: shots, their look and labels, loudness, silences and the beat of a media
 * file, worked out in the webview and kept on this computer. `describe.ts` reads OpenCut's
 * modules, so this loads after OpenCut's core (`loadVideoProjectTools`).
 */
export { analyseFootage, isSoundFile, type AnalyseOptions } from "./analyse";
export { describeFootage, describeProjectFootage } from "./describe";
export type {
  AudioAnalysis,
  BeatAnalysis,
  FootageAnalysis,
  FootageColor,
  FootageLabel,
  FootageScene,
  VisualAnalysis,
} from "./types";
