// Provider DOM adapters v1. Missing/ambiguous observations remain unknown. This
// function is host code; neither page content nor invocation input supplies code.
function () {
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector)).filter(visible);
  const one = (selector, root = document) => { const items = all(selector, root); return items.length === 1 ? items[0] : null; };
  const text = e => e ? (e.value ?? e.innerText ?? e.textContent ?? "") : "";
  const value = e => text(e).trim();
  const emails = text => [...new Set((text || "").match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const account = selector => { const e = one(selector); const found = emails([e?.getAttribute("aria-label"), e?.getAttribute("title"), e?.getAttribute("data-email"), value(e)].filter(Boolean).join(' ')); return found.length === 1 ? found[0] : ""; };
  if (location.hostname === 'app.todoist.com') {
    const result = { adapter: 'todoist', version: 1, account: account('[data-testid="user-menu-button"]') };
    const form = one('[data-testid="task-editor"]');
    const detail = one('[data-testid="task-detail"][data-item-id]');
    const root = form || detail;
    if (!root) return result;
    const project = one('[data-project-id]', root);
    const projectID = project?.getAttribute('data-project-id');
    if (!projectID) return result;
    const title = value(one('[aria-label="Task name"],[data-testid="task-content"]', root));
    const text = value(one('[aria-label="Description"],[data-testid="task-description"]', root));
    const date = one('[data-due-date]', root)?.getAttribute('data-due-date') || '';
    result.task = { destination: { containerReference: 'https://app.todoist.com/app/project/' + encodeURIComponent(projectID), label: value(project), targetId: '' }, title, text, source: { reference: '', label: '' } };
    if (date) result.task.dueDate = date;
    if (detail) result.task.taskReference = 'https://app.todoist.com/app/task/' + encodeURIComponent(detail.getAttribute('data-item-id'));
    return result;
  }
  return null;
}
