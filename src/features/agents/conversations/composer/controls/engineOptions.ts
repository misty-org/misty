import { listEngines, mistyEngine } from "../../../engines/enginesApi";

/**
 * What each engine offers the composer: its reasoning-effort levels (empty: it has none to
 * choose) and the modes it can honour. Native code still decides what a mode means for each
 * engine (`src-tauri/features/engines`); this only hides choices an engine would refuse.
 */
interface EngineOptions {
  efforts: string[];
  /** Manual, Auto, Plan and Bypass, by Misty's names. */
  modes: EngineMode[];
  /** The character that starts a skill in this engine's own syntax, if it has skills. */
  skillPrefix?: "/" | "$";
}

type EngineMode = "ask" | "auto" | "plan" | "bypass";

/** Misty's own agent has no skip-permissions mode. */
const all: EngineMode[] = ["ask", "auto", "plan"];
const engineAll: EngineMode[] = ["ask", "auto", "plan", "bypass"];

/** Until native code has said (`engines_list`), what each engine is known to offer. */
const options: Record<string, EngineOptions> = {
  claude: {
    efforts: ["low", "medium", "high", "xhigh", "max"],
    modes: engineAll,
    skillPrefix: "/",
  },
  codex: { efforts: ["low", "medium", "high", "xhigh"], modes: engineAll, skillPrefix: "$" },
  codebuddy: { efforts: ["low", "medium", "high", "xhigh", "max"], modes: engineAll },
  // Antigravity can't stop to ask; Pi can neither ask nor stay read-only.
  agy: { efforts: ["low", "medium", "high"], modes: ["auto", "plan", "bypass"] },
  pi: { efforts: ["minimal", "low", "medium", "high", "xhigh"], modes: ["auto"] },
  omp: {
    efforts: ["minimal", "low", "medium", "high", "xhigh"],
    modes: ["auto", "plan", "bypass"],
  },
  dsh: { efforts: [], modes: ["auto", "plan"] },
  opencode: { efforts: ["low", "medium", "high"], modes: engineAll },
};

/** The modes native code offers for each engine, once `engines_list` has answered. */
const reported: Record<string, EngineMode[]> = {};
let asked = false;

function askNative() {
  if (asked) return;
  asked = true;
  void listEngines()
    .then((engines) => {
      for (const engine of engines) if (engine.modes?.length) reported[engine.id] = engine.modes;
    })
    .catch(() => {
      asked = false;
    });
}

export function engineOptions(engine: string | undefined): EngineOptions {
  if (!engine || engine === mistyEngine) return { efforts: [], modes: all };
  askNative();
  const known = options[engine] ?? { efforts: [], modes: engineAll };
  return reported[engine] ? { ...known, modes: reported[engine] } : known;
}

/** An effort level as the menu shows it. */
export const effortLabel = (effort: string) =>
  effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1);
