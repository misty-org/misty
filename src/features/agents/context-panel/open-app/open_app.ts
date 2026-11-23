// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { create } from "zustand";
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agent_account";

export interface OpenAppTarget {
  id: string;
  label: string;
}

const OPEN_APP_TARGETS: readonly OpenAppTarget[] = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "idea", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
  { id: "zed", label: "Zed" },
  { id: "sublime", label: "Sublime Text" },
  { id: "xcode", label: "Xcode" },
  { id: "finder", label: finderLabel() },
];

const DEFAULT_OPEN_APP_ID = "vscode";

function finderLabel(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (platform.includes("Mac")) return "Finder";
  if (platform.includes("Win")) return "Explorer";
  return "File manager";
}

interface CustomProgram {
  id: string;
  name: string;
  path: string;
}

interface ProgramIcon {
  installed: boolean;
  icon?: string;
}

interface CustomResult {
  programs: CustomProgram[];
  added?: CustomProgram;
}

const account = () => agentAccountId();

const openAppApi = {
  openIn: (path: string, target: string) =>
    invoke<void>("project_open_in", { account: account(), path, target }),
  icon: (target: string) => invoke<ProgramIcon>("project_program_icon", { target }),
  custom: (request: { kind: "list" } | { kind: "add" } | { kind: "remove"; id: string }) =>
    invoke<CustomResult>("project_open_custom", { account: account(), request }),
  openCustom: (id: string, path: string) =>
    invoke<CustomResult>("project_open_custom", {
      account: account(),
      request: { kind: "open", id, path },
    }),
};

export const customTargetId = (program: CustomProgram) => `custom:${program.id}`;

export const useOpenApps = create<{
  icons: Record<string, ProgramIcon>;
  programs: CustomProgram[];
  loaded: boolean;
  load(): Promise<void>;
  add(): Promise<CustomProgram | null>;
  remove(id: string): Promise<void>;
}>((set, get) => ({
  icons: {},
  programs: [],
  loaded: false,
  async load() {
    if (get().loaded) return;
    const [icons, custom] = await Promise.all([
      Promise.all(
        OPEN_APP_TARGETS.map(async (target) => {
          const icon = await openAppApi
            .icon(target.id)
            .catch((): ProgramIcon => ({ installed: target.id === "finder" }));
          return [target.id, icon] as const;
        }),
      ),
      openAppApi.custom({ kind: "list" }).catch((): CustomResult => ({ programs: [] })),
    ]);
    set({ icons: Object.fromEntries(icons), programs: custom.programs, loaded: true });
    void loadCustomIcons(custom.programs);
  },
  async add() {
    const result = await openAppApi.custom({ kind: "add" });
    set({ programs: result.programs });
    void loadCustomIcons(result.programs);
    return result.added ?? null;
  },
  async remove(id) {
    const result = await openAppApi.custom({ kind: "remove", id });
    set({ programs: result.programs });
  },
}));

async function loadCustomIcons(programs: CustomProgram[]) {
  const missing = programs.filter((p) => !useOpenApps.getState().icons[customTargetId(p)]);
  for (const program of missing) {
    const id = customTargetId(program);
    const icon = await openAppApi.icon(id).catch((): ProgramIcon => ({ installed: true }));
    useOpenApps.setState((state) => ({ icons: { ...state.icons, [id]: icon } }));
  }
}

export function availableTargets(
  icons: Record<string, ProgramIcon>,
  programs: CustomProgram[],
): OpenAppTarget[] {
  const presets = OPEN_APP_TARGETS.filter(
    (target) => target.id === "finder" || icons[target.id]?.installed,
  );
  return [
    ...presets,
    ...programs.map((program) => ({ id: customTargetId(program), label: program.name })),
  ];
}

export function chosenTarget(
  targets: OpenAppTarget[],
  saved: string | undefined,
): OpenAppTarget | undefined {
  return (
    targets.find((target) => target.id === saved) ??
    targets.find((target) => target.id === DEFAULT_OPEN_APP_ID) ??
    targets[0]
  );
}

export async function openInTarget(path: string, target: OpenAppTarget): Promise<void> {
  if (target.id.startsWith("custom:")) {
    await openAppApi.openCustom(target.id.slice("custom:".length), path);
    return;
  }
  await openAppApi.openIn(path, target.id);
}
