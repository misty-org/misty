import { command } from "./factory";

export const callCommands = [
  command("call.toggle_mic", "Mute or unmute", {
    description: "Turn your microphone off or on in the call you're in.",
    category: "Calls",
    aliases: ["mute", "unmute", "microphone"],
    mac: "Cmd+Shift+M",
    windows: "Ctrl+Shift+M",
    allowInEditable: true,
  }),
  command("call.toggle_camera", "Turn camera on or off", {
    description: "Turn your camera on or off in the call you're in.",
    category: "Calls",
    aliases: ["video", "camera"],
    mac: "Cmd+Shift+O",
    windows: "Ctrl+Shift+O",
    allowInEditable: true,
  }),
  command("call.raise_hand", "Raise or lower hand", {
    description: "Raise your hand in the call you're in, or lower it.",
    category: "Calls",
    aliases: ["hand", "queue"],
    mac: "Cmd+Shift+H",
    windows: "Ctrl+Shift+H",
    allowInEditable: true,
  }),
  command("call.toggle_captions", "Turn captions on or off", {
    description: "Show what people say in the call you're in as captions.",
    category: "Calls",
    aliases: ["subtitles", "transcript"],
    mac: "Cmd+Shift+C",
    windows: "Ctrl+Shift+C",
    allowInEditable: true,
  }),
  command("call.push_to_talk", "Hold to talk", {
    description: "Unmute while the keys are held, then mute again.",
    category: "Calls",
    aliases: ["push to talk", "talk"],
    mac: "Option+Space",
    windows: "Ctrl+Alt+Space",
  }),
];
