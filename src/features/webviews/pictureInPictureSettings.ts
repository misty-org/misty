/** Account setting: keep a playing video going in a floating window when its tab is hidden. */
let autoEnabled = true;

export function configureAutoPictureInPicture(value: boolean): void {
  autoEnabled = value;
}

export function autoPictureInPictureEnabled(): boolean {
  return autoEnabled;
}

/** Picture in picture needs engine support; WebKitGTK has none. */
export function pictureInPictureSupported(): boolean {
  return !/Linux/i.test(navigator.platform);
}
