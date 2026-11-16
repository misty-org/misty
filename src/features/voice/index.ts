export { DictationController } from "./DictationController";
export { DictationPill } from "./pill/DictationPill";
export { CaptureBarStatus, CaptureMenu, CapturePanel, transcribeLibraryFile } from "./capture";

// Public surface used by other features.
export { VoiceSection } from "./settings/VoiceSection";
export { voiceCleanup, voiceDevice } from "./api";
export {
  chosenVoice,
  copyAnswer,
  listen,
  onCall,
  outputMuted,
  soundOn,
  openReading,
  recognitionLanguage,
  recognizeAudio,
  recognizeFile,
  say,
  speechSupport,
  stopSaying,
  useSpeechSupport,
  type Listening,
  type Reading,
  type SpeechSupport,
  type SystemVoice,
} from "./systemSpeech";
export { vocativeRouting } from "./vocativeRoute";
export { matchVocative, type Vocative } from "./vocative";
export { noteAsk } from "./capture/openNote";

export { voiceEngine, type VoiceEngine } from "./voiceEngine";
