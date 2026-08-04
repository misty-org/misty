function enabled(value: unknown): boolean {
  return value === "true";
}

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

/** Production builds opt in only after the backward-compatible server migration lands. */
export function agentTeammatesV1Enabled(): boolean {
  const configured = import.meta.env.VITE_AGENT_TEAMMATES_V1;
  return configured === undefined || configured === "" ? import.meta.env.DEV : enabled(configured);
}
