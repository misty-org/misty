/**
 * The window a tab works in after Detach (docs/design/agents-at-cursor/BRIEF.md): the page
 * fills it edge to edge with nothing drawn here; the dock's pill says what the agent is doing
 * and holds Open and Stop. An extension's popup window holds only the extension's page.
 */
export function AgentDockHostRoot() {
  return null;
}
