/** Picture in picture needs engine support; WebKitGTK has none. */
export function pictureInPictureSupported(): boolean {
  return !/Linux/i.test(navigator.platform);
}
