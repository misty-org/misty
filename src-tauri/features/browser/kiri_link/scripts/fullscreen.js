if (window === window.top) {
  let fullscreenReported = false;
  const reportFullscreen = () => {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (active === fullscreenReported) return;
    if (sendToHost('{"token":"' + shortcutToken + '","fullscreen":' + (active ? 'true' : 'false') + '}'))
      fullscreenReported = active;
  };
  document.addEventListener('fullscreenchange', reportFullscreen, true);
  document.addEventListener('webkitfullscreenchange', reportFullscreen, true);
}
