export type MistyNotificationLevel = "info" | "success" | "error";

export type MistyWebHost = {
  selectedPaths?: () => Promise<string[]>;
  notify?: (notification: {
    level: MistyNotificationLevel;
    title: string;
    message: string;
    pluginId: string;
  }) => void;
  runCommand?: <T = unknown>(command: string, payload?: Record<string, unknown>) => Promise<T>;
};

declare global {
  interface Window {
    mistyPluginHost?: MistyWebHost;
  }
}

export async function readSelectedPathsFromHost() {
  if (window.mistyPluginHost?.selectedPaths) {
    return window.mistyPluginHost.selectedPaths();
  }

  const params = new URLSearchParams(window.location.search);
  return params
    .getAll("selected")
    .flatMap((value) => value.split("\n"))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function publishHostNotification(
  pluginId: string,
  level: MistyNotificationLevel,
  title: string,
  message: string,
) {
  if (window.mistyPluginHost?.notify) {
    window.mistyPluginHost.notify({ level, title, message, pluginId });
    return;
  }

  window.dispatchEvent(
    new CustomEvent("misty:plugin-notification", {
      detail: { level, title, message, pluginId },
    }),
  );
}

export async function runHostCommand<T = unknown>(
  command: string,
  payload?: Record<string, unknown>,
) {
  if (window.mistyPluginHost?.runCommand) {
    return window.mistyPluginHost.runCommand<T>(command, payload);
  }

  return {
    ok: false,
    command,
    payload,
    message: "Misty has not attached a web plugin host bridge yet.",
  } as T;
}
