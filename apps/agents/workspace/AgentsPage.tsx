import { useState } from "react";
import { MistyDashboard } from "./components/MistyDashboard";
import { McpConnectionsSheet } from "./mcp/McpConnectionsSheet";
export default function DesktopAgentsPage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MistyDashboard onManageConnections={() => setOpen(true)} />
      <McpConnectionsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
