import { desktopOs } from "../desktopOs";
export const tmpdir = () => "/tmp";
// Midscene picks its keyboard modifiers from this, so report the real host.
export const platform = () => {
  const os = desktopOs();
  return os === "macos" ? "darwin" : os === "windows" ? "win32" : "linux";
};
export const EOL = "\n";
export default { tmpdir, platform, EOL };
