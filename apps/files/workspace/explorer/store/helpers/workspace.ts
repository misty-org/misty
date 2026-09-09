export function isExplorerInternalTabPath(path: string): boolean {
  return (
    path.startsWith("misty-transfers://") ||
    path.startsWith("misty-remotes://") ||
    path.startsWith("misty-plugin://")
  );
}
