  // The top edge of a page moves the window, as a titlebar would: press on empty space there
  // and drag. Links, controls, text and anything the page gives a special cursor keep their
  // clicks. The drag starts only once the pointer has moved, so a plain click is the page's.
  const dragZone = () => Math.min(72, window.innerHeight * 0.05);
  // A wrapper that spans the page (an app shell with a tabindex, or a pointer cursor set on a
  // whole layout) must not turn the whole top edge into content.
  const spansPage = (element) => {
    const box = element.getBoundingClientRect();
    return box.width >= window.innerWidth * 0.8 && box.height >= window.innerHeight * 0.5;
  };
  const interactiveTarget = (target) => {
    const element = target instanceof Element ? target : target && target.parentElement;
    if (!element) return true;
    if (element.closest(
      'a[href], button, input, textarea, select, summary, label, video, audio, canvas, iframe, ' +
      '[role="button"], [role="link"], [role="textbox"], [role="menuitem"], [role="tab"], ' +
      '[contenteditable]:not([contenteditable="false"]), [draggable="true"]'
    )) return true;
    for (let node = element; node; node = node.parentElement) {
      if (node.matches('[tabindex]:not([tabindex="-1"])') && !spansPage(node)) return true;
    }
    const cursor = getComputedStyle(element).cursor;
    if (cursor === 'auto' || cursor === 'default') return false;
    // The cursor is inherited: find where it starts, and ignore it when that is a page-wide wrapper.
    let origin = element;
    while (origin.parentElement && getComputedStyle(origin.parentElement).cursor === cursor)
      origin = origin.parentElement;
    return !spansPage(origin);
  };
  let dragStart = null;
  let lastTopPress = null;
  document.addEventListener('pointerdown', (event) => {
    dragStart = null;
    if (!event.isTrusted || event.button !== 0 || window !== window.top) return;
    if (event.clientY > dragZone() || interactiveTarget(event.target)) {
      lastTopPress = null;
      return;
    }
    // A second press in the same spot is the titlebar's double-click: zoom or restore.
    const now = performance.now();
    if (lastTopPress && now - lastTopPress.time <= 500 &&
        Math.abs(event.clientX - lastTopPress.x) + Math.abs(event.clientY - lastTopPress.y) <= 8) {
      lastTopPress = null;
      sendToHost('{"token":"' + shortcutToken + '","zoom":true}');
      return;
    }
    lastTopPress = { time: now, x: event.clientX, y: event.clientY };
    dragStart = { x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    if (!event.isTrusted || (event.buttons & 1) === 0) {
      dragStart = null;
      return;
    }
    if (Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y) < 4) return;
    dragStart = null;
    sendToHost('{"token":"' + shortcutToken + '","drag":true}');
  }, true);
  document.addEventListener('pointerup', () => { dragStart = null; }, true);
