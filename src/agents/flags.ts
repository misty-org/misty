function enabled(value: unknown): boolean { return value === "true"; }

export function mistyAgentsEnabled(): boolean {
  return enabled(import.meta.env.VITE_MISTY_AGENTS_ENABLED);
}

export function mistyDocumentsEnabled(): boolean {
  return mistyAgentsEnabled() && enabled(import.meta.env.VITE_MISTY_DOCUMENTS_ENABLED);
}

export function mistyDeviceJobsEnabled(): boolean {
  return mistyAgentsEnabled() && enabled(import.meta.env.VITE_MISTY_DEVICE_JOBS_ENABLED);
}

export function mistyFolderAgentsEnabled(): boolean {
  return mistyAgentsEnabled() && enabled(import.meta.env.VITE_MISTY_FOLDER_AGENTS_ENABLED);
}
