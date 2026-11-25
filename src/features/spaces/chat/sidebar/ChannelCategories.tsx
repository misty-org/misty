import { ArrowDown, ArrowUp, FolderPlus, Plus, Settings, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  IconButton,
  MenuItem,
  MenuSeparator,
  NavGroupHeading,
  notify,
  RenameItemDialog,
  RowActions,
  RowTools,
  useConfirmDelete,
  usePointerDropTarget,
  usePointerReorder,
} from "@misty/ui";
import { spacesApi } from "../../api/api";
import type { SpaceChannelCategory, SpaceConversation } from "../../api/dto/entities";
import {
  categoryDragScope,
  channelDragScope,
  dropCategory,
  dropChannel,
  neighbour,
} from "./channel_drag";
import { moveTargets, type ChannelCategoryGroup, type ChannelLayout } from "./channel_layout";
import { toggleCategory, useCollapsedCategories } from "./collapsed_categories";
import { CreateEditConversationDialog } from "./CreateEditConversationDialog";
import { useCanManageChannels } from "./NewChannelButton";
import { useSpaceConversations } from "./use_space_conversations";

type CategoryDialog = "create" | "edit" | null;

export function ChannelHeadingTools(props: {
  spaceId: string;
  category?: SpaceChannelCategory | null;
  categories: SpaceChannelCategory[];
  onCreated(conversation: SpaceConversation): void;
}) {
  const category = props.category ?? null;
  const manage = useCanManageChannels(props.spaceId);
  const { upsert, upsertCategory, removeCategory, reload } = useSpaceConversations(props.spaceId);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<CategoryDialog>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDelete();
  const moves = category ? moveTargets(props.categories, category.id) : null;

  const move = (afterId: string | null) => {
    if (!category) return;
    void spacesApi
      .updateCategory(props.spaceId, category.id, { afterId })
      .then(() => reload())
      .catch(() => notify({ message: "The category couldn't be moved. Try again.", tone: "error" }));
  };

  const remove = () => {
    if (!category) return;
    void confirm({
      title: `Delete "${category.name}"?`,
      what: "Its channels move out of it to the top, and keep their messages.",
      onConfirm: async () => {
        await spacesApi.deleteCategory(props.spaceId, category.id);
        removeCategory(category.id);
        void reload().catch(() => undefined);
      },
    });
  };

  if (!manage) return null;
  return (
    <span data-reorder-ignore="" className="contents">
      <RowTools reveal="hover">
        <IconButton label="Create channel" onClick={() => setCreating(true)}>
          <Plus />
        </IconButton>
        <RowActions label={category ? "Category actions" : "Channel actions"}>
          {() => (
            <>
              <MenuItem icon={Plus} label="Create channel" onSelect={() => setCreating(true)} />
              {category ? (
                <>
                  <MenuItem
                    icon={Settings}
                    label="Edit category"
                    onSelect={() => setDialog("edit")}
                  />
                  {moves?.up !== undefined || moves?.down !== undefined ? <MenuSeparator /> : null}
                  {moves?.up !== undefined ? (
                    <MenuItem icon={ArrowUp} label="Move up" onSelect={() => move(moves.up!)} />
                  ) : null}
                  {moves?.down !== undefined ? (
                    <MenuItem
                      icon={ArrowDown}
                      label="Move down"
                      onSelect={() => move(moves.down!)}
                    />
                  ) : null}
                  <MenuSeparator />
                  <MenuItem icon={Trash2} label="Delete category" danger onSelect={remove} />
                </>
              ) : (
                <MenuItem
                  icon={FolderPlus}
                  label="Create category"
                  onSelect={() => setDialog("create")}
                />
              )}
            </>
          )}
        </RowActions>
      </RowTools>
      <CreateEditConversationDialog
        spaceId={props.spaceId}
        open={creating}
        onOpenChange={setCreating}
        conversation={null}
        categoryId={category?.id ?? null}
        onSaved={(saved) => {
          upsert(saved);
          setCreating(false);
          props.onCreated(saved);
        }}
      />
      {dialog ? (
        <RenameItemDialog
          key={dialog === "edit" ? category?.id : "create"}
          title={dialog === "edit" ? "Edit category" : "Create category"}
          confirmLabel={dialog === "edit" ? "Save" : "Create"}
          initialName={dialog === "edit" ? (category?.name ?? "") : ""}
          onConfirm={async (name) => {
            const trimmed = name.slice(0, 80);
            const saved =
              dialog === "edit" && category
                ? await spacesApi.updateCategory(props.spaceId, category.id, { name: trimmed })
                : await spacesApi.createCategory(props.spaceId, trimmed);
            upsertCategory(saved);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {confirmDialog}
    </span>
  );
}

export function ChannelList(props: {
  spaceId: string;
  categoryId: string | null;
  channels: SpaceConversation[];
  shown?: SpaceConversation[];
  className?: string;
  row(conversation: SpaceConversation): ReactNode;
}) {
  const manage = useCanManageChannels(props.spaceId);
  const drop = (moving: string, target: string, after: boolean) =>
    dropChannel(props.spaceId, props.categoryId, props.channels, moving, target, after);
  const reorder = usePointerReorder({
    scope: channelDragScope(props.spaceId),
    axis: "y",
    getDrag: (id) => {
      if (!manage) return null;
      const channel = props.channels.find((item) => item.id === id);
      return channel ? { id, label: channel.title } : null;
    },
    onDrop: (drag, target, after) => drop(drag.id, target, after),
    onKeyboardMove: (id, direction) => {
      const target = neighbour(props.channels, id, direction);
      if (target) drop(id, target.id, direction === 1);
    },
  });
  return (
    <div {...reorder} className={props.className}>
      {(props.shown ?? props.channels).map((channel) =>
        manage ? (
          <div key={channel.id} data-reorder-item={channel.id} data-reorder-handle="">
            {props.row(channel)}
          </div>
        ) : (
          props.row(channel)
        ),
      )}
    </div>
  );
}

type CategorySectionProps = {
  spaceId: string;
  group: ChannelCategoryGroup;
  categories: SpaceChannelCategory[];
  keepShown: (string | null | undefined)[];
  className?: string;
  listClassName?: string;
  row(conversation: SpaceConversation): ReactNode;
  onCreated(conversation: SpaceConversation): void;
};

export function ChannelCategorySection(props: CategorySectionProps) {
  const manage = useCanManageChannels(props.spaceId);
  if (!manage && !props.group.channels.length) return null;
  return <CategorySection {...props} manage={manage} />;
}

function CategorySection(props: CategorySectionProps & { manage: boolean }) {
  const { category, channels } = props.group;
  const manage = props.manage;
  const collapsed = useCollapsedCategories((state) => state.value.includes(category.id));
  const heading = useRef<HTMLDivElement>(null);
  usePointerDropTarget(heading, {
    scope: channelDragScope(props.spaceId),
    hit: () => {
      const rect = heading.current?.getBoundingClientRect();
      return manage && rect ? { id: "", after: true, rect, axis: "y", box: true } : null;
    },
    drop: (drag) => dropChannel(props.spaceId, category.id, channels, drag.id, "", true),
  });
  const shown = collapsed
    ? channels.filter((channel) => props.keepShown.includes(channel.id))
    : channels;
  return (
    <section
      className={props.className}
      aria-label={category.name}
      data-reorder-item={manage ? category.id : undefined}
    >
      <NavGroupHeading
        ref={heading}
        name={category.name}
        collapsible={{ open: !collapsed, onToggle: () => toggleCategory(category.id) }}
        className="group/row"
        data-reorder-handle={manage ? "" : undefined}
      >
        <ChannelHeadingTools
          spaceId={props.spaceId}
          category={category}
          categories={props.categories}
          onCreated={props.onCreated}
        />
      </NavGroupHeading>
      <ChannelList
        spaceId={props.spaceId}
        categoryId={category.id}
        channels={channels}
        shown={shown}
        className={props.listClassName}
        row={props.row}
      />
    </section>
  );
}

export function ChannelCategoryList(props: {
  spaceId: string;
  layout: ChannelLayout;
  keepShown: (string | null | undefined)[];
  className?: string;
  sectionClassName?: string;
  row(conversation: SpaceConversation): ReactNode;
  onCreated(conversation: SpaceConversation): void;
}) {
  const manage = useCanManageChannels(props.spaceId);
  const categories = props.layout.categories.map((group) => group.category);
  const drop = (moving: string, target: string, after: boolean) =>
    dropCategory(props.spaceId, categories, moving, target, after);
  const reorder = usePointerReorder({
    scope: categoryDragScope(props.spaceId),
    axis: "y",
    getDrag: (id) => {
      if (!manage) return null;
      const category = categories.find((item) => item.id === id);
      return category ? { id, label: category.name } : null;
    },
    onDrop: (drag, target, after) => drop(drag.id, target, after),
    onKeyboardMove: (id, direction) => {
      const target = neighbour(categories, id, direction);
      if (target) drop(id, target.id, direction === 1);
    },
  });
  if (!props.layout.categories.length) return null;
  return (
    <div {...reorder} className={props.className}>
      {props.layout.categories.map((group) => (
        <ChannelCategorySection
          key={group.category.id}
          spaceId={props.spaceId}
          group={group}
          categories={categories}
          keepShown={props.keepShown}
          className={props.sectionClassName}
          listClassName={props.sectionClassName}
          row={props.row}
          onCreated={props.onCreated}
        />
      ))}
    </div>
  );
}
