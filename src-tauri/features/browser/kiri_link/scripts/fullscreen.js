// Report when the page has an element in full screen, so Misty can let the page fill its whole
// window instead of its pane. Only the on/off state is sent.
if (window === window.top) {
  let fullscreenReported = false;
  const reportFullscreen = () => {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (active === fullscreenReported) return;
    // Built by concatenation: a page-defined toJSON must never see the token.
    if (sendToHost('{"token":"' + shortcutToken + '","fullscreen":' + (active ? 'true' : 'false') + '}'))
      fullscreenReported = active;
  };
  document.addEventListener('fullscreenchange', reportFullscreen, true);
  document.addEventListener('webkitfullscreenchange', reportFullscreen, true);
}
