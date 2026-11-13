import {
  ActionBar,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ChoiceTile,
  CollectionItems,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  EmptyState,
  IconButton,
  iconBarItem,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  SuggestionItem,
  SuggestionList,
  type CollectionItem,
} from "@/shared/ui";
import {
  Activity,
  Bot,
  Download,
  FileText,
  Folder,
  LibraryBig,
  Paperclip,
  Pencil,
  Settings,
  Sheet,
} from "lucide-react";
import { useState } from "react";
import { GalleryPane, GalleryRow, GallerySection } from "./GalleryLayout";

const catalog: CollectionItem[] = [
  {
    id: "brief",
    title: "Quarterly planning brief for the studio team, with every open question",
    icon: <FileText />,
    tone: "blue",
    category: "Document",
    updated: "2h",
    onOpen: () => {},
    menu: <MenuItem icon={Pencil} label="Rename" onSelect={() => {}} />,
  },
  {
    id: "budget",
    title: "Budget",
    icon: <Sheet />,
    tone: "green",
    category: "Sheet",
    updated: "Nov 4",
    onOpen: () => {},
  },
  {
    id: "assets",
    title: "Assets",
    icon: <Folder />,
    tone: "sand",
    category: "Folder",
    updated: "Oct 30",
    onOpen: () => {},
  },
];

const tiles = [
  { id: "sun", label: "Sun", glyph: "☀️" },
  { id: "moon", label: "Moon", glyph: "🌙" },
  { id: "leaf", label: "Leaf", glyph: "🍃" },
];

/** Rows, cards and pickers that carry what an item is: icons, avatars, a second line, tiles. */
export function RichRowsSection() {
  const [installed, setInstalled] = useState(false);
  const [tile, setTile] = useState("sun");
  const [agent, setAgent] = useState("writer");
  return (
    <GallerySection title="Rows with icons, descriptions and tiles">
      <GalleryRow label="ListRow leading, badge, trailing">
        <div className="grid w-96 gap-px">
          <ListRow
            label="Notes"
            leading={FileText}
            leadingTone="blue"
            state={{ kind: "unread" }}
            onOpen={() => {}}
          />
          <ListRow
            label="Pat Lee"
            leading={
              <Avatar size="xs">
                <AvatarFallback>PL</AvatarFallback>
              </Avatar>
            }
            onOpen={() => {}}
          />
          <ListRow
            label="frontend-design"
            description="Builds distinctive interfaces with a clear point of view"
            badge={<Badge variant="outline">Plugin</Badge>}
            onOpen={() => {}}
            trailing={
              <Button
                size="sm"
                icon={Download}
                disabled={installed}
                onClick={() => setInstalled(true)}
              >
                {installed ? "Installed" : "Install"}
              </Button>
            }
            menu={<MenuItem icon={Pencil} label="Rename" onSelect={() => {}} />}
          />
        </div>
      </GalleryRow>
      <GalleryRow label="ListRowSkeleton leading, 2 lines">
        <ListRowSkeleton label="Loading skills" rows={3} leading lines={2} className="w-96" />
      </GalleryRow>
      <GalleryRow label="EmptyState title only">
        <GalleryPane>
          <EmptyState title="Nothing on the calendar this month" />
        </GalleryPane>
      </GalleryRow>
      <GalleryRow label="ChoiceTile">
        <div role="group" aria-label="Avatar" className="grid grid-cols-3 gap-2">
          {tiles.map((item) => (
            <ChoiceTile
              key={item.id}
              label={item.label}
              caption={item.label}
              look="outline"
              selected={tile === item.id}
              onSelect={() => setTile(item.id)}
            >
              <span className="text-display">{item.glyph}</span>
            </ChoiceTile>
          ))}
        </div>
      </GalleryRow>
      <GalleryRow label="IconButton hint">
        <IconButton
          label="Check the server"
          hint="A check starts the server, completes the handshake, then stops it."
        >
          <Activity />
        </IconButton>
      </GalleryRow>
      <GalleryRow label="CommandItem description, end">
        <Command className="w-80">
          <CommandList>
            <CommandGroup heading="Add to message">
              <CommandItem
                icon={LibraryBig}
                label="Browse Library"
                description="Select one or more shared items"
              />
              <CommandItem
                icon={Paperclip}
                label="Upload files"
                description="Choose with Misty's file picker"
              />
            </CommandGroup>
            <CommandGroup heading="Agents">
              {["writer", "reviewer"].map((id) => (
                <CommandItem
                  key={id}
                  label={id === "writer" ? "Writer" : "Reviewer"}
                  checked={agent === id}
                  onSelect={() => setAgent(id)}
                  end={
                    <ActionBar
                      label="Agent actions"
                      size="sm"
                      width="content"
                      items={[
                        iconBarItem({
                          id: "settings",
                          icon: Settings,
                          label: "Agent settings",
                          size: "sm",
                          priority: 1,
                          onSelect: () => {},
                        }),
                      ]}
                    />
                  }
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </GalleryRow>
      <GalleryRow label="SuggestionItem detail">
        <SuggestionList className="w-80">
          <SuggestionItem selected icon={Bot} label="Writer" detail="Drafts and edits long text" />
          <SuggestionItem selected={false} icon={Bot} label="Reviewer" detail="Code review" />
        </SuggestionList>
      </GalleryRow>
      <GalleryRow label="CollectionItems listIcons">
        <div className="w-full">
          <CollectionItems items={catalog} categoryLabel="Kind" listIcons />
        </div>
      </GalleryRow>
      <GalleryRow label="Compact cards, 2-line titles">
        <div className="w-full">
          <CollectionItems items={catalog} view="grid" gridLayout="compact" cardTitleLines={2} />
        </div>
      </GalleryRow>
    </GallerySection>
  );
}
