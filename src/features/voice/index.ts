export { DictationController } from "./DictationController";
export { DictationPill } from "./pill/DictationPill";
export { CaptureBarStatus, CaptureMenu, CapturePanel, transcribeAudioFile } from "./capture";

// Public surface used by other features.
export { VoiceSection } from "./settings/VoiceSection";
export { DevicesSection } from "./settings/DevicesSection";
export { speechLanguages, voiceLabel, voiceSample } from "./settings/speechChoices";
export { voiceSettings } from "./voiceSettings";
export { savedInputDevice } from "./inputDevice";
export { voiceCleanup, voiceDevice } from "./api";
export {
  chosenVoice,
  copyAnswer,
  hear,
  listen,
  onCall,
  outputMuted,
  soundOn,
  openReading,
  previewVoice,
  recognitionLanguage,
  recognitionLanguages,
  recognizeAudio,
  recognizeAudioWords,
  recognizeFile,
  renderSpeech,
  say,
  speechSupport,
  stopSaying,
  useSpeechSupport,
  SPEECH_CHANGED,
  type HearingEvent,
  type HearingSession,
  type HeardWord,
  type Listening,
  type Reading,
  type RenderedSpeech,
  type SpeechSupport,
} from "./speech";
export {
  apply as applySpeech,
  chooseHearing,
  chooseMistyVoice,
  covers,
  ensureSpeech,
  personLanguages,
  rankHearing,
  useSpeechModels,
  voicesFor,
  type HearingModelView,
  type InstallProgress,
  type Machine,
  type VoiceView,
} from "./speechModels";
export { vocativeRouting } from "./vocativeRoute";
export { matchVocative, type Vocative } from "./vocative";
export { noteAsk } from "./capture/openNote";

export { voiceEngine, type VoiceEngine } from "./voiceEngine";
