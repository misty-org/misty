// Misty agent page runtime, part 5: pattern and app skills
// (docs/plans/agent-harness.md, Page layer). Most hard web UIs are a few
// widget types; each skill detects its pattern on any site and offers actions
// for it. App skills only add what one app's quirks need. A skill either acts
// in the page directly (pasting into a grid or an editor, reading values) or
// returns steps for the step runner, so clicks stay native and gated.
((P) => {
  const S = P.state;
  const visible = (el) => !!el && !P.hidden(el);
  const EDITABLE = '.ProseMirror,[data-lexical-editor],.ql-editor,[contenteditable=""],[contenteditable=true]';
  /** Editable areas in this document and its same-origin frames, where editors such as
   * CKEditor and TinyMCE keep theirs (the frame's body is the editable area). */
  const editables = () => {
    const found = [];
    const look = (doc, depth) => {
      found.push(...doc.querySelectorAll(EDITABLE));
      if (doc !== document && doc.body && (doc.body.isContentEditable || doc.designMode === "on")) found.push(doc.body);
      if (depth >= 2) return;
      for (const frame of doc.querySelectorAll("iframe")) {
        let inner = null;
        try { inner = frame.contentDocument; } catch { inner = null; }
        if (inner) look(inner, depth + 1);
      }
    };
    look(document, 0);
    return found;
  };
  /** How tall an editable area shows: an editor frame's body is as tall as its frame. */
  const shownHeight = (el) => el === el.ownerDocument.body
    ? Math.max(el.clientHeight, el.ownerDocument.defaultView?.frameElement?.clientHeight ?? 0) : el.clientHeight;
  const host = location.hostname;
  const path = location.pathname;

  /** Cell names like B12 or ranges like A1:C5. */
  const cellRef = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
  const parseCell = (value) => {
    const match = cellRef.exec(String(value || "").trim().toUpperCase());
    if (!match) return null;
    let column = 0;
    for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
    return { column, row: Number(match[2]), name: match[0] };
  };

  const rowsFrom = (args) => {
    if (Array.isArray(args.rows)) return args.rows.map((row) => (Array.isArray(row) ? row : [row]).map((value) => String(value ?? "")));
    if (typeof args.tsv === "string") return args.tsv.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    return null;
  };

  /** Fires a paste the way a person's paste reaches the page's handlers. */
  const paste = (target, data) => {
    const view = target.ownerDocument.defaultView;
    const transfer = new view.DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    const event = new view.ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true, composed: true });
    // Some engines drop clipboardData from the constructor; expose it anyway.
    if (!event.clipboardData) Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const markdownToHtml = (markdown) => {
    const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (text) => escape(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
    const out = [];
    let list = "";
    const closeList = () => { if (list) { out.push(`</${list}>`); list = ""; } };
    for (const raw of String(markdown).replace(/\r/g, "").split("\n")) {
      const line = raw.trimEnd();
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
      else if (bullet || numbered) {
        const kind = bullet ? "ul" : "ol";
        if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
        out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else if (!line.trim()) closeList();
      else { closeList(); out.push(`<p>${inline(line)}</p>`); }
    }
    closeList();
    return out.join("");
  };
  P.markdownToHtml = markdownToHtml;

  const editorOf = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.isContentEditable && (!node.parentElement || !node.parentElement.isContentEditable)) return node;
    }
    return null;
  };

  // --- Skills -----------------------------------------------------------------

  const grid = {
    id: "grid",
    detect: () => {
      const gridEl = document.querySelector('[role=grid],[role=treegrid],table[contenteditable]');
      return !!gridEl && visible(gridEl) && gridEl.querySelectorAll('[role=gridcell],td').length >= 4;
    },
    instructions: "Spreadsheet grid: write many cells in one call with browser_skill grid.paste {cell: \"A1\", rows: [[...],[...]]} (or tsv), read cells with grid.read, and jump with grid.goto {cell}. Paste fills rows down and columns right from the cell. Check the result with grid.read before saving.",
    actions: {
      goto: (args) => {
        const cell = parseCell(args.cell);
        if (!cell) return { ok: false, attempted: false, error: "Give a cell such as B3." };
        const box = skills.nameBox();
        if (!box) {
          const target = skills.cellElement(cell.name);
          if (!target) return { ok: false, attempted: false, error: "This grid has no name box and the cell is not on screen." };
          return { ok: true, steps: [{ action: "click", ref: P.register(target) }] };
        }
        return { ok: true, steps: [{ action: "fill", ref: P.register(box), text: cell.name, submit: true }] };
      },
      read: (args) => {
        const cells = skills.cellMap();
        if (!cells.size) return { ok: false, attempted: false, error: "No readable cells; this grid draws on a canvas. Use the app's API if it is connected." };
        const from = parseCell(args.from || "A1") || { column: 1, row: 1 };
        const to = parseCell(args.to || "") || { column: from.column + 25, row: from.row + 99 };
        const rows = [];
        for (let row = from.row; row <= to.row; row++) {
          const values = [];
          for (let column = from.column; column <= to.column; column++) {
            let name = "";
            for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
            values.push(cells.get(`${name}${row}`) ?? "");
          }
          while (values.length && values[values.length - 1] === "") values.pop();
          rows.push(values.join("\t"));
        }
        while (rows.length && rows[rows.length - 1] === "") rows.pop();
        return { ok: true, attempted: false, tsv: rows.join("\n") };
      },
      paste: (args) => {
        const rows = rowsFrom(args);
        const cell = parseCell(args.cell || "A1");
        if (!rows?.length || !cell) return { ok: false, attempted: false, error: "Give a start cell and rows (or tsv)." };
        if (rows.length > 1000 || rows.some((row) => row.length > 100)) return { ok: false, attempted: false, error: "Paste at most 1000 rows of 100 cells at a time." };
        const tsv = rows.map((row) => row.join("\t")).join("\n");
        const html = `<table>${rows.map((row) => `<tr>${row.map((value) => `<td>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("")}</table>`;
        // The grid must select the start cell first; the step runner does that
        // with real input, then calls back for the paste itself.
        const box = skills.nameBox();
        const select = box ? [{ action: "fill", ref: P.register(box), text: cell.name, submit: true }]
          : skills.cellElement(cell.name) ? [{ action: "click", ref: P.register(skills.cellElement(cell.name)) }] : null;
        if (!select) return { ok: false, attempted: false, error: "Cannot select the start cell: no name box and the cell is not on screen." };
        return { ok: true, steps: select, then: { skill: "grid", action: "pasteHere", args: { tsv, html, cells: rows.length * Math.max(...rows.map((row) => row.length)) } } };
      },
      pasteHere: (args) => {
        const target = skills.pasteTarget();
        if (!target) return { ok: false, error: "No focused grid to paste into." };
        const handled = paste(target, { "text/plain": args.tsv, "text/html": args.html });
        return { ok: handled, attempted: true, pasted: handled ? args.cells : 0,
          error: handled ? undefined : "The grid ignored the paste. Type the cells instead, one by one." };
      },
    },
  };

  const editor = {
    id: "editor",
    // Google Docs has its own skill: its canvas ignores pasted content.
    detect: () => !(host === "docs.google.com" && path.startsWith("/document")) &&
      editables().some((el) => visible(el) && shownHeight(el) > 60),
    instructions: "Rich-text editor: write formatted text in one call with browser_skill editor.insert {ref, markdown} (headings with #, lists with - or 1., **bold**, links). It keeps the formatting, unlike typing. Use at: \"end\" (default), \"start\" or \"replace\". Read the editor with editor.read {ref}.",
    actions: {
      insert: (args) => {
        const resolved = args.ref ? P.resolve(args.documentId, args.ref) : { ok: true, el: skills.editorTarget() };
        if (!resolved.ok) return resolved;
        const root = editorOf(resolved.el) || skills.editorTarget();
        if (!root) return { ok: false, attempted: false, error: "Give the ref of the editor area." };
        const markdown = String(args.markdown ?? "");
        if (!markdown.trim() || markdown.length > 100000) return { ok: false, attempted: false, error: "Give 1–100000 characters of markdown." };
        const doc = root.ownerDocument;
        const view = doc.defaultView;
        root.focus();
        const selection = view.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(root);
        if (args.at !== "replace") range.collapse(args.at === "start");
        selection.removeAllRanges();
        selection.addRange(range);
        const html = markdownToHtml(markdown);
        const before = root.innerHTML;
        // Editors (ProseMirror, Lexical, Quill, Docs, Word, Notion) take pastes;
        // a plain editable area takes the browser's own insertion.
        const handled = paste(root, { "text/html": html, "text/plain": markdown });
        if (!handled) {
          const locked = view.__MISTY_AGENT_INPUT_LOCKED__;
          try {
            view.__MISTY_AGENT_INPUT_LOCKED__ = false;
            if (args.at === "replace") doc.execCommand("delete");
            if (!doc.execCommand("insertHTML", false, html)) return { ok: false, attempted: true, error: "The editor did not accept the text." };
          } finally {
            view.__MISTY_AGENT_INPUT_LOCKED__ = locked;
          }
        }
        return { ok: true, attempted: true, via: handled ? "paste" : "insert", changed: root.innerHTML !== before };
      },
      read: (args) => {
        const resolved = args.ref ? P.resolve(args.documentId, args.ref) : { ok: true, el: skills.editorTarget() };
        if (!resolved.ok) return resolved;
        const root = editorOf(resolved.el) || resolved.el;
        if (!root) return { ok: false, attempted: false, error: "No editor found." };
        return { ok: true, attempted: false, text: P.clipText(root.innerText ?? root.textContent, 20000) };
      },
    },
  };

  const forms = {
    id: "forms",
    detect: () => Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]),textarea,select,[role=radio],[role=checkbox]'))
      .filter(visible).length >= 3,
    instructions: "Forms and surveys: answer by question in one call with browser_skill forms.answer {answers: [{question, value}]}, where value is text, a choice's label, or a list of labels for checkboxes. It fills text and picks choices by their labels, then returns the steps it ran. It never submits.",
    actions: {
      answer: (args) => {
        const answers = Array.isArray(args.answers) ? args.answers.slice(0, 50) : [];
        if (!answers.length) return { ok: false, attempted: false, error: "Give answers as [{question, value}]." };
        const steps = [];
        const missing = [];
        const norm = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const fieldSelector = 'textarea,select,input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=submit]):not([type=button]):not([type=file]),[role=textbox],[role=combobox],[contenteditable=true]';
        const choiceSelector = 'input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],[role=option]';
        const fields = Array.from(document.querySelectorAll(fieldSelector)).filter(visible);
        const groups = Array.from(document.querySelectorAll('fieldset,[role=radiogroup],[role=group],[role=listitem],[role=list],div,section,li'))
          .filter((el) => visible(el) && el.querySelector(choiceSelector));
        const matches = (label, question) => {
          const name = norm(label);
          return !!name && !!question && (name === question || name.includes(question) || (name.length >= 3 && question.includes(name)));
        };
        const smallest = (list) => list.sort((a, b) => (a.innerText ?? a.textContent ?? "").length - (b.innerText ?? b.textContent ?? "").length)[0];
        for (const answer of answers) {
          const question = norm(answer.question);
          const values = Array.isArray(answer.value) ? answer.value.map(String) : [String(answer.value ?? "")];
          if (!question) { missing.push(String(answer.question)); continue; }
          // A field labelled with the question, then a choice group that names it.
          const field = fields.find((el) => norm(P.name(el)) === question) || fields.find((el) => matches(P.name(el), question));
          const group = field ? null : smallest(groups.filter((el) => matches(P.name(el, "group"), question) || norm(el.innerText ?? el.textContent).includes(question)));
          if (field) {
            if (P.secret(field)) { missing.push(answer.question); continue; }
            if (field.tagName === "SELECT") steps.push({ action: "select", ref: P.register(field), values });
            else steps.push({ action: "fill", ref: P.register(field), text: values.join(", ") });
            continue;
          }
          const choices = group ? Array.from(group.querySelectorAll(choiceSelector)).filter((el) => visible(el) || (el.labels && el.labels.length)) : [];
          if (!choices.length) { missing.push(answer.question); continue; }
          for (const value of values) {
            const wanted = norm(value);
            const choice = choices.find((el) => norm(P.name(el)) === wanted) || choices.find((el) => norm(P.name(el)).includes(wanted));
            if (!choice) { missing.push(`${answer.question}: ${value}`); continue; }
            const checked = choice.tagName === "INPUT" ? choice.checked : choice.getAttribute("aria-checked") === "true";
            if (!checked) steps.push({ action: "click", ref: P.register(choice) });
          }
        }
        if (!steps.length) return { ok: false, attempted: false, error: `No questions matched: ${missing.join("; ")}` };
        return { ok: true, steps: steps.slice(0, 30), missing };
      },
    },
  };

  const pickers = {
    id: "pickers",
    detect: () => !!document.querySelector('[role=combobox],input[list],[aria-autocomplete],input[type=date],[role=grid][aria-label*=calendar i],[class*=datepicker i],[class*=calendar i] button'),
    instructions: "Autocompletes and date pickers: browser_skill pickers.choose {ref, text} types into a combobox and picks the option whose label matches; pickers.date {ref, date: \"2026-11-14\"} sets a date field or clicks the day in an open calendar.",
    actions: {
      choose: (args) => {
        const resolved = P.resolve(args.documentId, args.ref);
        if (!resolved.ok) return resolved;
        const text = String(args.text ?? "");
        if (!text) return { ok: false, attempted: false, error: "Give the option text." };
        return { ok: true, steps: [{ action: "fill", ref: args.ref, text }, { action: "wait_for", text, timeoutMs: 3000 }],
          then: { skill: "pickers", action: "clickOption", args: { text } } };
      },
      clickOption: (args) => {
        const wanted = String(args.text).toLowerCase();
        const options = Array.from(document.querySelectorAll('[role=option],[role=listbox] li,datalist option')).filter(visible);
        const option = options.find((el) => (el.innerText ?? el.textContent).trim().toLowerCase() === wanted)
          || options.find((el) => (el.innerText ?? el.textContent).trim().toLowerCase().includes(wanted));
        if (!option) return { ok: true, attempted: false, note: "No list appeared; the typed text stays as the value." };
        return { ok: true, steps: [{ action: "click", ref: P.register(option) }] };
      },
      date: (args) => {
        const resolved = P.resolve(args.documentId, args.ref);
        if (!resolved.ok) return resolved;
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(args.date || ""));
        if (!match) return { ok: false, attempted: false, error: "Give the date as YYYY-MM-DD." };
        const el = resolved.el;
        if (el && el.tagName === "INPUT" && el.type === "date") return { ok: true, steps: [{ action: "fill", ref: args.ref, text: match[0] }] };
        const day = Number(match[3]);
        const month = new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleString("en", { month: "long" });
        const buttons = Array.from(document.querySelectorAll('button,[role=gridcell],td')).filter(visible);
        const exact = buttons.find((button) => { const label = P.name(button); return label.includes(month) && new RegExp(`\\b${day}\\b`).test(label); })
          || buttons.find((button) => (button.innerText ?? button.textContent).trim() === String(day) && !button.disabled);
        if (exact) return { ok: true, steps: [{ action: "click", ref: P.register(exact) }] };
        if (el && (el.tagName === "INPUT" || el.isContentEditable)) return { ok: true, steps: [{ action: "fill", ref: args.ref, text: `${match[2]}/${match[3]}/${match[1]}` }] };
        return { ok: false, attempted: false, error: "No date field or calendar day found; open the calendar first." };
      },
    },
  };

  const boards = {
    id: "boards",
    detect: () => document.querySelectorAll('[role=list] [role=listitem] button,[data-testid*=card i],[class*=kanban i],[class*=board i] [role=listitem]').length >= 2,
    instructions: "Boards and record views: cards usually move through a card menu (Move, ⋯ or right-click) rather than dragging; open it with a click, then pick the destination. Edit fields on the card or in its detail view by ref.",
    actions: {},
  };

  // App skills: only what a pattern cannot know about one app.
  const mac = /Mac/.test(navigator.platform);
  const primary = mac ? { metaKey: true } : { ctrlKey: true };
  // Google's own export of the saved file, read with the person's session.
  // Synchronous, so it works where the page call cannot await (WebView2).
  const exportText = (url) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send();
    if (request.status !== 200) throw new Error(`Google returned ${request.status} for the export.`);
    return request.responseText;
  };
  const fileId = (kind) => new RegExp(`/${kind}/(?:u/\\d+/)?d/([^/]+)`).exec(path)?.[1];

  const sheets = {
    id: "google-sheets",
    detect: () => host === "docs.google.com" && path.startsWith("/spreadsheets"),
    instructions: "Google Sheets draws its grid on a canvas, so the snapshot shows no cells. If Google Sheets is connected as an app, use its API for reading and bulk writes. Otherwise use this skill: google-sheets.paste {cell: \"A1\", rows: [[...],[...]]} writes many cells at once (values or formulas such as =SUM(B2:E2)) through the Name box; google-sheets.goto {cell} selects a cell; google-sheets.read returns the saved values as CSV a few seconds after writing.",
    actions: {
      // The grid pattern's own actions, through the Name box Sheets provides.
      paste: (args) => grid.actions.paste(args),
      goto: (args) => grid.actions.goto(args),
      read: () => {
        const id = fileId("spreadsheets");
        if (!id) return { ok: false, attempted: false, error: "Open a spreadsheet first." };
        const gid = /[#&?]gid=(\d+)/.exec(location.href)?.[1] ?? "0";
        try {
          return { ok: true, attempted: false, csv: P.clipText(exportText(`/spreadsheets/d/${id}/export?format=csv&gid=${gid}`), 40000) };
        } catch (error) {
          return { ok: false, attempted: false, error: String(error.message || error) };
        }
      },
    },
  };

  // Google Docs draws text on a canvas and takes input in a hidden text field;
  // it ignores pasted HTML from a script, but it does take inserted text and its
  // own keyboard shortcuts there.
  const docsInput = () => {
    const frame = document.querySelector(".docs-texteventtarget-iframe");
    const doc = frame?.contentDocument;
    return doc ? doc.querySelector("[contenteditable=true]") || doc.body : null;
  };
  const docsKey = (target, key, code, keyCode, modifiers = {}) => {
    const KeyboardEvent = target.ownerDocument.defaultView.KeyboardEvent;
    for (const type of ["keydown", "keyup"])
      target.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ...modifiers }));
  };
  const docsBlocks = (markdown) => markdown.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    let match;
    if ((match = /^(#{1,6})\s+(.*)$/.exec(line))) return { kind: "heading", level: match[1].length, text: match[2] };
    if ((match = /^\s*[-*+]\s+(.*)$/.exec(line))) return { kind: "bullet", text: match[1] };
    if ((match = /^\s*\d+[.)]\s+(.*)$/.exec(line))) return { kind: "number", text: match[1] };
    return { kind: "text", text: line.trim() };
  });

  const docs = {
    id: "google-docs",
    detect: () => host === "docs.google.com" && path.startsWith("/document"),
    instructions: "Google Docs draws text on a canvas, so the snapshot shows no document text. Read the saved document with browser_skill google-docs.read. Write with google-docs.write {markdown, at}: at is \"end\" (default), \"start\" or \"replace\"; # headings, - bullets, 1. numbered items and **bold** keep their formatting. Docs saves a few seconds after writing.",
    actions: {
      read: () => {
        const id = fileId("document");
        if (!id) return { ok: false, attempted: false, error: "Open a document first." };
        try {
          return { ok: true, attempted: false, text: P.clipText(exportText(`/document/d/${id}/export?format=txt`).replace(/^\uFEFF/, ""), 40000) };
        } catch (error) {
          return { ok: false, attempted: false, error: String(error.message || error) };
        }
      },
      write: (args) => {
        const markdown = String(args.markdown ?? "");
        if (!markdown.trim() || markdown.length > 20000) return { ok: false, attempted: false, error: "Give 1–20000 characters of markdown." };
        const at = ["start", "replace", "end"].includes(args.at) ? args.at : "end";
        const target = docsInput();
        if (!target) return { ok: false, attempted: false, error: "The document is still loading; wait for it, then write again." };
        const insert = (text) => target.ownerDocument.execCommand("insertText", false, text);
        const enter = () => docsKey(target, "Enter", "Enter", 13);
        const lists = { bullet: ["8", "Digit8", 56], number: ["7", "Digit7", 55] };
        const toggleList = (kind) => docsKey(target, ...lists[kind], { ...primary, shiftKey: true });
        const style = (level) => docsKey(target, String(level), `Digit${level}`, 48 + level, { ...primary, altKey: true });
        target.focus();
        if (at === "replace") docsKey(target, "a", "KeyA", 65, primary);
        else if (at === "start") mac ? docsKey(target, "ArrowUp", "ArrowUp", 38, primary) : docsKey(target, "Home", "Home", 36, primary);
        else mac ? docsKey(target, "ArrowDown", "ArrowDown", 40, primary) : docsKey(target, "End", "End", 35, primary);
        const blocks = docsBlocks(markdown);
        let list = null;
        blocks.forEach((block, index) => {
          if (index > 0 || at === "end") enter();
          const kind = block.kind === "bullet" || block.kind === "number" ? block.kind : null;
          if (list && list !== kind) toggleList(list);
          style(block.kind === "heading" ? Math.min(block.level, 6) : 0);
          if (kind && list !== kind) toggleList(kind);
          list = kind;
          // **bold** spans toggle bold; links keep their text and address.
          const text = block.text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");
          text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).forEach((part) => {
            const bold = /^\*\*[^*]+\*\*$/.test(part);
            if (bold) docsKey(target, "b", "KeyB", 66, primary);
            insert(bold ? part.slice(2, -2) : part);
            if (bold) docsKey(target, "b", "KeyB", 66, primary);
          });
        });
        if (list) toggleList(list);
        if (at === "start") enter();
        return { ok: true, attempted: true, via: "keyboard", paragraphs: blocks.length };
      },
    },
  };

  const skills = {
    list: [grid, editor, forms, pickers, boards, sheets, docs],
    nameBox: () => {
      const box = document.querySelector('#t-name-box,input[aria-label="Name box" i],input[aria-label*="name box" i]');
      return box && visible(box) ? box : null;
    },
    cellMap: () => {
      const map = new Map();
      for (const cell of document.querySelectorAll('[role=gridcell][aria-label],[role=gridcell][data-k]')) {
        const name = (cell.getAttribute("aria-label") || cell.dataset.k || "").trim().toUpperCase();
        if (cellRef.test(name)) map.set(name, (cell.innerText ?? cell.textContent).trim());
      }
      return map;
    },
    cellElement: (name) => document.querySelector(`[role=gridcell][aria-label="${name}" i],[role=gridcell][data-k="${name}"]`),
    pasteTarget: () => {
      // Sheets receives keyboard and clipboard input in a hidden editor.
      const sheetsInput = document.querySelector('#waffle-rich-text-editor,.cell-input');
      if (sheetsInput) return sheetsInput;
      const active = document.activeElement;
      if (active && active !== document.body) return active;
      return document.querySelector('[role=grid],[role=treegrid]');
    },
    editorTarget: () => {
      const docsFrame = document.querySelector('.docs-texteventtarget-iframe');
      try { if (docsFrame?.contentDocument?.body) return docsFrame.contentDocument.body; } catch { /* cross-origin */ }
      return editables().filter(visible).sort((a, b) => shownHeight(b) - shownHeight(a))[0] || null;
    },
  };
  P.skills = skills;

  /** Skills present on this page, with what the agent should know about them. */
  P.detectSkills = () => skills.list.filter((skill) => { try { return skill.detect(); } catch { return false; } })
    .map((skill) => ({ id: skill.id, instructions: skill.instructions, actions: Object.keys(skill.actions).filter((name) => !/Here$|^click/.test(name)) }));

  /** Runs one skill action. Results with steps go back to the step runner. */
  P.skill = (args) => {
    if (!S.documentId || args.documentId !== S.documentId) return { ok: false, attempted: false, errorCode: "browser_snapshot_stale", error: "The page changed since its snapshot. Take a new snapshot." };
    const skill = skills.list.find((item) => item.id === args.skill);
    const action = skill?.actions[args.action];
    if (!action) return { ok: false, attempted: false, error: `Unknown skill action ${args.skill}.${args.action}. This page offers: ${P.detectSkills().map((item) => `${item.id} (${item.actions.join(", ")})`).join("; ") || "none"}.` };
    return action({ ...(args.args || {}), documentId: args.documentId });
  };
})(globalThis.__mistyAgentPageV1 ??= {});
