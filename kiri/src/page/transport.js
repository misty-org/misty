// Kiri's page side. Runs in each top-level document before the site's own
// scripts. Shims build spec-shaped objects and marshal calls; every decision
// (who is calling, permission, platform support) is made in Rust.
(() => {
  if (window.top !== window) return;
  const internals = window.__TAURI_INTERNALS__;
  const invoke =
    internals && typeof internals.invoke === 'function' ? internals.invoke.bind(internals) : null;
  // Captured before page scripts can replace them.
  const PageDOMException = window.DOMException;
  const PageTypeError = TypeError;

  const toError = (error) => {
    const name = error && typeof error.name === 'string' ? error.name : 'UnknownError';
    const message = error && typeof error.message === 'string' ? error.message : String(error);
    return name === 'TypeError' ? new PageTypeError(message) : new PageDOMException(message, name);
  };

  const call = (cap, method, args) =>
    invoke
      ? invoke('plugin:kiri|call', {
          request: { v: 1, cap, method, args: args === undefined ? null : args },
        }).catch((error) => {
          throw toError(error);
        })
      : Promise.reject(new PageDOMException('Kiri is not available in this view.', 'NotSupportedError'));

  // One-way reports: the page has nothing to wait for.
  const signal = (cap, method, args) => {
    call(cap, method, args).catch(() => {});
  };

  __KIRI_CAPABILITIES__
})();
