// The only import path for shared UI. Features import from "@/shared/ui", never a subfolder.

// controls
export * from "./controls/BackButton";
export * from "./controls/Button";
export * from "./controls/Checkbox";
export * from "./controls/ChoiceGroup";
export * from "./controls/ChoiceList";
export * from "./controls/ChoiceTile";
export * from "./controls/ColorSwatch";
export * from "./controls/CopyButton";
export * from "./controls/DragHandleButton";
export * from "./controls/Field";
export * from "./controls/FileInput";
export * from "./controls/FilterChip";
export * from "./controls/IconButton";
export * from "./controls/Input";
export * from "./controls/SearchField";
export * from "./controls/SecretField";
export * from "./controls/ShortcutField";
export * from "./controls/Label";
export * from "./controls/OptionSelect";
export * from "./controls/Select";
export * from "./controls/Slider";
export * from "./controls/Switch";
export * from "./controls/Textarea";
export * from "./controls/Pressable";

// overlays
export * from "./overlays/OverlaySide";
export * from "./overlays/AlertDialog";
export * from "./overlays/Command";
export * from "./overlays/ConfirmDeleteDialog";
export * from "./overlays/ContextMenu";
export * from "./overlays/Dialog";
export * from "./overlays/DropdownMenu";
export * from "./overlays/MenuItem";
export * from "./overlays/MenuChevron";
export * from "./overlays/MenuTrigger";
export * from "./overlays/Popover";
export * from "./overlays/Portal";
export * from "./overlays/RowActions";
export * from "./overlays/SearchablePicker";
export * from "./overlays/Sheet";
export * from "./overlays/SuggestionList";
export * from "./overlays/Tooltip";
export * from "./overlays/ViewportLayer";
export * from "./overlays/WorkspaceOverlay";

// layout
export * from "./layout/ActionBar";
export * from "./layout/Collapsible";
export * from "./layout/FloatingPanel";
export * from "./layout/OverflowFadeText";
export * from "./layout/PageHeader";
export * from "./layout/PathLine";
export * from "./layout/SectionHeading";
export * from "./layout/PageStage";
export * from "./layout/IconBarItem";
export * from "./layout/ScrollArea";
export * from "./layout/Separator";

// display
export * from "./display/Avatar";
export * from "./display/Badge";
export * from "./display/Card";
export * from "./display/CodeBlock";
export * from "./display/Kbd";
export * from "./display/ListRow";
export * from "./display/PropertyList";
export * from "./display/Prose";
export * from "./display/StateMark";
export * from "./display/Table";
export * from "./display/Text";
export * from "./display/TreeRow";

// feedback
export * from "./feedback/FlyingMisty";
export * from "./feedback/LoadingScreen";
export * from "./feedback/Progress";
export * from "./feedback/Skeleton";
export * from "./feedback/Spinner";
export * from "./feedback/StateView";
// Named; resetNotices is for tests, which import it through this barrel too.
export {
  NoticeViewport,
  dismissNotice,
  notify,
  resetNotices,
  useNotice,
  type NoticeAction,
  type NoticeHandle,
  type NoticeOptions,
  type NoticeTone,
} from "./feedback/notices";

// navigation
export * from "./navigation/TabStrip";

// icons
export * from "./icons/AssetIcon";
export * from "./icons/BrandIcon";
export * from "./icons/appIcons";
export * from "./icons/brandIcons";
export * from "./icons/itemTones";

// patterns
export * from "./patterns/CollectionWorkspace";
export * from "./patterns/CollectionFilterMenu";
export * from "./patterns/RenameItemDialog";
export * from "./patterns/MessageActions";
export * from "./patterns/QuestionPanel";
export * from "./patterns/FindBar";

export * from "./classNames";

export {
  MessageComposer,
  MessageComposerSend,
  messageComposerTextClass,
} from "./patterns/MessageComposer";
