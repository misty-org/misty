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
  const recipients = elements => {
    const found = [...new Set(elements.flatMap(e => emails(e.getAttribute("email") || e.getAttribute("data-email") || e.getAttribute("title") || value(e))))];
    return found.map(address => ({ address }));
  };
  const url = location.href;
  if (location.hostname === "mail.google.com") {
    const result = { adapter: "gmail", version: 1, account: account('#gb a[aria-label^="Google Account:"],#gb button[aria-label^="Google Account:"]') };
    const messages = all('[data-message-id][data-legacy-message-id]');
    const bodies = all('.a3s');
    if (!messages.length || !bodies.length) return result;
    result.thread = url;
    const last = messages[messages.length - 1];
    result.message = url + (url.includes("#") ? "&" : "#") + "message=" + encodeURIComponent(last.getAttribute("data-legacy-message-id"));
    result.text = value(bodies[bodies.length - 1]);
    result.subject = value(one('h2.hP'));
    result.recipients = recipients(all('[email]', last).filter(e => !e.classList.contains('gD')));
    const editor = one('[contenteditable="true"][role="textbox"][aria-label="Message Body"]');
    if (editor) {
      const form = editor.closest('form') || editor.closest('.M9') || editor.parentElement;
      const draftID = form?.querySelector('input[name="draft"]')?.value;
      const to = recipients(all('[email],textarea[name="to"],input[name="to"]', form));
      if (draftID && to.length) result.draft = { reference: url + "&draft=" + encodeURIComponent(draftID), thread: url, text: text(editor), subject: result.subject, recipients: to };
    }
    // A status toast alone cannot verify which message was sent. Require an
    // opened sent item whose sender is the observed account and whose full body
    // and recipients can be compared with the review.
    const sender = one('.gD[email]', last)?.getAttribute('email');
    if (sender === result.account && result.recipients.length) result.sent = { reference: result.message, thread: url, text: result.text, subject: result.subject, recipients: result.recipients };
    return result;
  }
  if (["outlook.live.com", "outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft"].includes(location.hostname)) {
    const result = { adapter: "outlook", version: 1, account: account('#O365_MainLink_Me') };
    const message = one('[data-message-id]');
    if (!message) return result;
    result.thread = url;
    result.message = url + (url.includes('?') ? '&' : '?') + 'message=' + encodeURIComponent(message.getAttribute('data-message-id'));
    result.subject = value(one('[role="heading"]', message));
    result.text = value(one('[aria-label="Message body"]', message));
    result.recipients = recipients(all('[data-email][data-recipient-type]', message));
    const editor = one('[role="textbox"][contenteditable="true"][aria-label="Message body"], [role="textbox"][contenteditable="true"][aria-label="Message Body"]');
    if (editor) {
      const form = editor.closest('[data-draft-id]');
      const draftID = form?.getAttribute('data-draft-id');
      const to = form ? recipients(all('[data-email][data-recipient-type]', form)) : [];
      if (draftID && to.length) result.draft = { reference: url + '&draft=' + encodeURIComponent(draftID), thread: url, text: text(editor), subject: result.subject, recipients: to };
    }
    if (message.getAttribute('data-folder') === 'sentitems' && message.getAttribute('data-sender-email') === result.account && result.recipients.length) result.sent = { reference: result.message, thread: url, text: result.text, subject: result.subject, recipients: result.recipients };
    return result;
  }
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
