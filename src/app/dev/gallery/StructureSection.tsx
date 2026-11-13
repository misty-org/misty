import {
  Button,
  Card,
  ChoiceList,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FloatingPanel,
  IconButton,
  Input,
  ListRow,
  MenuItem,
  PageHeader,
  PropertyList,
  Prose,
  ProseCallout,
  ProseCode,
  ProseTable,
  QuestionPanel,
  SectionHeading,
  SkeletonList,
  StateMark,
  Text,
  type DialogSize,
} from "@/shared/ui";
import { Filter, Info, MessageSquarePlus, Plus } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection, GalleryStage } from "./GalleryLayout";

const questionOptions = [
  { label: "Keep the old API", description: "Old callers keep compiling; nothing moves yet." },
  { label: "Move every caller", description: "One change across the app, reviewed together." },
  { label: "Ask the team first" },
];

function ChoiceSamples() {
  const [one, setOne] = useState<string[]>(["Move every caller"]);
  const [many, setMany] = useState<string[]>([]);
  return (
    <div className="grid w-full max-w-md gap-6">
      <QuestionPanel
        label="Misty is asking"
        title="How should the move land?"
        aside="1 of 2"
        actions={
          <Button variant="primary" disabled={!one.length}>
            Next
          </Button>
        }
      >
        <ChoiceList
          label="How should the move land?"
          options={questionOptions}
          selected={one}
          onSelect={(value) => setOne([value])}
          shortcuts
        />
        <Input aria-label="Other answer" placeholder="Something else" />
      </QuestionPanel>
      <ChoiceList
        label="Which checks run"
        multiple
        options={[{ label: "Types" }, { label: "Lint" }, { label: "Unit tests" }]}
        selected={many}
        onSelect={(value) =>
          setMany((current) =>
            current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
          )
        }
      />
    </div>
  );
}

function SectionSample() {
  const [open, setOpen] = useState(true);
  return (
    <div className="grid w-72">
      <SectionHeading
        title="Channels"
        count={3}
        open={open}
        onOpenChange={setOpen}
        controls="gallery-channels"
        action={{ label: "New channel", icon: Plus, onSelect: () => {} }}
      />
      {open ? (
        <div id="gallery-channels" className="grid">
          <ListRow label="general" state={{ kind: "unread" }} />
          <ListRow label="design-protocol-and-a-very-long-channel-name" />
          <ListRow label="releases" state={{ kind: "time", at: Date.now() - 3_600_000 }} />
        </div>
      ) : null}
      <SectionHeading
        title="Direct messages"
        action={{
          label: "New message",
          icon: MessageSquarePlus,
          menu: <MenuItem icon={MessageSquarePlus} label="Message a member" onSelect={() => {}} />,
        }}
      />
      <SectionHeading
        title="Pages"
        action={{ label: "See all", showLabel: true, onSelect: () => {} }}
      />
    </div>
  );
}

function DialogSample({ size }: { size: DialogSize }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        {size}
      </Button>
      <DialogContent size={size} layout="scroll">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <PropertyList
            label="Shortcuts"
            items={Array.from({ length: 40 }, (_, index) => ({
              id: String(index),
              label: `Command ${index + 1}`,
              value: `⌘${index + 1}`,
            }))}
          />
        </DialogBody>
        <DialogFooter>
          <Button size="lg" variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Structure pieces: marks, headings, properties, choices, prose and dialog sizes. */
export function StructureSection() {
  return (
    <GallerySection title="Structure">
      <GalleryRow label="StateMark">
        <StateMark kind="working" />
        <StateMark kind="waiting" />
        <StateMark kind="unread" />
        <StateMark kind="done" />
        <StateMark kind="failed" label="Failed: the key was refused" />
      </GalleryRow>
      <GalleryRow label="ListRow states">
        <div className="grid w-72">
          <ListRow label="Run finished" state={{ kind: "done" }} />
          <ListRow label="Run failed" state={{ kind: "failed", label: "Failed: out of credits" }} />
          <ListRow label="Picked for a bulk move" checked state={{ kind: "unread" }} />
          <ListRow label="Not picked" checked={false} state={{ kind: "time", at: Date.now() }} />
        </div>
      </GalleryRow>
      <GalleryRow label="SectionHeading">
        <SectionSample />
      </GalleryRow>
      <GalleryRow label="PropertyList">
        <div className="grid w-80 gap-6">
          <PropertyList
            label="Run details"
            items={[
              { label: "Model", value: "claude-opus-with-a-long-model-name-that-fades" },
              { label: "Folder", value: "~/misty-org/misty/src/shared/ui" },
              { label: "State", value: <StateMark kind="done" /> },
            ]}
          />
          <PropertyList
            layout="stacked"
            items={[{ label: "Path", value: "~/misty-org/misty/src/shared/ui/display/Prose.tsx" }]}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="EmptyState inline">
        <div className="grid w-80">
          <EmptyState
            inline
            title="No approvals yet"
            line="Approvals you remember show here."
            action={{ label: "Learn more", icon: Info, onClick: () => {} }}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="SkeletonList on a card">
        <Card className="w-80 px-5 py-3">
          <SkeletonList label="Approvals" rows={3} trailing />
        </Card>
      </GalleryRow>
      <GalleryRow label="ChoiceList, QuestionPanel">
        <ChoiceSamples />
      </GalleryRow>
      <GalleryRow label="Prose">
        <Prose size="body" className="w-full max-w-md">
          <h2>Moving the prose styles</h2>
          <p>
            Replies, plans and previews read alike. Only <code>code</code> is monospace, and{" "}
            <a href="#prose">links</a> stay monochrome.
          </p>
          <ul>
            <li>Headings, lists and quotes</li>
            <li>Tables that scroll sideways</li>
          </ul>
          <ProseCallout kind="note" label="Note" icon={Info}>
            <p>Callouts carry their kind as an icon and a label.</p>
          </ProseCallout>
          <ProseTable>
            <thead>
              <tr>
                <th>Part</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Prose</td>
                <td>src/shared/ui/display</td>
              </tr>
            </tbody>
          </ProseTable>
          <ProseCode language="ts">{`const prose = <Prose size="body" />;`}</ProseCode>
        </Prose>
      </GalleryRow>
      <GalleryRow label="Dialog sizes">
        {(["sm", "md", "lg", "xl", "media"] as const).map((size) => (
          <DialogSample key={size} size={size} />
        ))}
      </GalleryRow>
      <GalleryRow label="Header nodes">
        <div className="w-full max-w-lg">
          <PageHeader
            title={
              <Text size="page" weight="medium" tone="bright" full>
                A drawn title, such as a switcher
              </Text>
            }
            actions={[{ id: "new", icon: Plus, label: "New", priority: 1, onSelect: () => {} }]}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="FloatingPanel actions">
        <GalleryStage className="h-56 w-full max-w-lg">
          <FloatingPanel
            anchor="top-left"
            width="sm"
            title="Agents"
            onClose={() => {}}
            actions={
              <IconButton label="Filter agents" size="sm" variant="quiet">
                <Filter />
              </IconButton>
            }
          >
            <ListRow label="Planner" state={{ kind: "working" }} />
            <ListRow label="Reviewer" state={{ kind: "waiting" }} />
          </FloatingPanel>
        </GalleryStage>
      </GalleryRow>
    </GallerySection>
  );
}
