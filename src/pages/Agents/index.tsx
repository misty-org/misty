// Beta UI gate: the Agents surface is intentionally inert. The full desktop
// implementation stays on disk under ./desktop but is never imported here, so
// no agent store initializes and no /agents or /ai/models request is made.
export default function AgentsPage() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">Agents are coming soon...</p>
    </div>
  );
}
