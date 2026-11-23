import { desktopOs } from "../desktop_os";
export const tmpdir = () => "/tmp";
export const platform = () => {
  const os = desktopOs();
  return os === "macos" ? "darwin" : os === "windows" ? "win32" : "linux";
};
export const EOL = "\n";
export default { tmpdir, platform, EOL };
