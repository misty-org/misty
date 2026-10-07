import { agentRequest } from "../data/project";
import type { AgentsState, AppState } from "../film/state";
import { linear, typed, typingEnd } from "../film/time";
import { base, group, groupedTabs, tabs, type SceneScript } from "./common";

const CPS = 22;
const T = { open: 54.2, agent: 55.05, attach: 55.95, type: 56.75, send: 0, reading: 0, reply: 0 };
T.send = typingEnd(agentRequest, T.type, CPS) + 0.4;
T.reading = T.send + 1.6;
T.reply = T.reading + 2.6;

function agents(t: number): AgentsState {
  if (t < T.agent) return {};
  const state: AgentsState = { agent: "project-planner", attachment: t >= T.attach + 0.25, draft: typed(agentRequest, t, T.type, CPS) };
  if (t >= T.send) {
    state.sent = true;
    state.working = linear(t, T.send, T.reading - T.send);
    state.reply = linear(t, T.reading, T.reply - T.reading);
  }
  return state;
}

export function agentsApp(t: number): AppState {
  return base({
    rail: "agents",
    group,
    tabs: groupedTabs(tabs.team, tabs.files, tabs.transfers, tabs.agents),
    active: "agents",
    agents: agents(t),
  });
}

export const agentsScript: SceneScript = {
  moves: [
    { at: T.open, to: "desktop:rail-agents", click: true, dur: 0.6 },
    { at: T.agent, to: "desktop:agent-project-planner", click: true, dur: 0.55 },
    { at: T.attach, to: "desktop:agent-attach", click: true, dur: 0.6 },
    { at: T.send, to: "desktop:agent-send", click: true, dur: 0.7 },
    { at: T.reply + 0.6, to: "desktop:agent-reply", dur: 1.4, anchor: { x: 0.9, y: 0.85 } },
  ],
  cams: [
    { t: 54.0, at: [760, 300], zoom: 1.4 },
    { t: 54.6, at: [720, 450], zoom: 1.18 },
    { t: 55.6, at: "desktop:agent-composer", zoom: 1.8, dy: -60 },
    { t: T.send, at: "desktop:agent-composer", zoom: 1.8, dy: -60 },
    { t: T.send + 0.8, at: [860, 280], zoom: 1.75 },
    { t: T.reading + 0.6, at: [860, 330], zoom: 1.6 },
    { t: T.reply + 0.4, at: [840, 400], zoom: 1.6 },
    { t: 65.4, at: [840, 400], zoom: 1.6 },
  ],
  typing: [{ start: T.type, chars: agentRequest.length, cps: CPS }],
  chimes: [T.reading],
};
