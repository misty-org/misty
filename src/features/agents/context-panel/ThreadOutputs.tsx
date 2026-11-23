import { FileOutput } from "lucide-react";
import { Text } from "@misty/ui";
import { folderName, useThreadOutputs, type ThreadOutput } from "../threads/thread_work";
import { useContextPanel } from "./context_panel_store";
import { useFilesStore } from "./files/files_store";
import { Row, Section } from "./SessionRows";

const MOST = 8;

const parentOf = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
};

function preview(output: ThreadOutput) {
  if (!output.local) return;
  void useFilesStore.getState().openFile(output.local);
  useContextPanel.getState().show("files");
}

export function ThreadOutputs(props: { conversationId: string }) {
  const outputs = useThreadOutputs(props.conversationId);
  if (!outputs?.length) return null;
  const shown = outputs.slice(0, MOST);
  return (
    <Section title="Outputs" icon={FileOutput} subject={String(outputs.length)}>
      {shown.map((output) => (
        <Row
          key={output.path}
          label={folderName(output.path)}
          value={
            <Text bare tone="muted">
              {folderName(parentOf(output.path))}
            </Text>
          }
          onOpen={output.local ? () => preview(output) : undefined}
        />
      ))}
      {outputs.length > shown.length ? (
        <Text size="meta" tone="muted" wrap className="py-1">
          {outputs.length - shown.length} more
        </Text>
      ) : null}
    </Section>
  );
}
