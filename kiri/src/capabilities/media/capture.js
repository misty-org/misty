// media (Windows): WebView2 cannot stop capture from outside the page, so keep
// the streams getUserMedia hands out and let the host end them when the user
// revokes access. The hook cannot be replaced or removed by site scripts.
{
  const streams = new Set();
  const devices = navigator.mediaDevices;
  if (devices && typeof devices.getUserMedia === 'function' && typeof WeakRef === 'function') {
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (constraints) =>
      getUserMedia(constraints).then((stream) => {
        streams.add(new WeakRef(stream));
        return stream;
      });
  }
  Object.defineProperty(window, '__kiriStopCapture', {
    value: (camera, microphone) => {
      for (const reference of streams) {
        const stream = reference.deref();
        if (!stream) {
          streams.delete(reference);
          continue;
        }
        for (const track of stream.getTracks()) {
          if ((camera && track.kind === 'video') || (microphone && track.kind === 'audio')) track.stop();
        }
      }
    },
  });
}
