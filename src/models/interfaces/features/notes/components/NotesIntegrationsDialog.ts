import type {
  NotesConnector,
  NotesIntegrationCard,
} from "@/models/interfaces/features/notes/connectors";

export interface NotesIntegrationsDialogProps {
  open: boolean;
  connectors: NotesConnector[];
  adjacent: NotesIntegrationCard[];
  busy: boolean;
  connectorErrors: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onConnect: (connectorId: string) => void;
  onDisconnect: (connectorId: string) => void;
  onConfigure: (connectorId: string) => void;
}

export interface ConnectorCardProps {
  connector: NotesConnector;
  busy: boolean;
  error?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onConfigure: () => void;
}

export interface NewNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; body: string }) => void | Promise<void>;
}
