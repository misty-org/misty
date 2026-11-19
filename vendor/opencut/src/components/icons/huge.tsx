// Misty: OpenCut draws its icons from Hugeicons; in Misty every glyph is a Lucide icon at one size
// and stroke (src/styles/App.css). These are the Hugeicons names OpenCut uses, each mapped to the
// Lucide icon of the same subject, and `HugeiconsIcon` draws one. A `size` or `strokeWidth` passed
// in is ignored: Misty icons take neither.
import type { ComponentType, SVGProps } from "react";
import {
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowDown01,
	ArrowLeftRight,
	ArrowRight,
	ArrowUp,
	ArrowUpToLine,
	Bookmark,
	Captions,
	CaseSensitive,
	ChartSpline,
	Check,
	ChevronDown,
	ChevronsRight,
	Circle,
	CircleAlert,
	CloudUpload,
	Columns3,
	Copy,
	Diamond,
	Droplet,
	Eraser,
	Expand,
	Eye,
	EyeOff,
	Feather,
	Filter,
	Folder,
	GalleryHorizontal,
	Gauge,
	Headphones,
	Heart,
	Image,
	Layers,
	LayoutGrid,
	Link,
	ListEnd,
	ListPlus,
	LoaderCircle,
	Magnet,
	Maximize,
	Minus,
	Film,
	Music,
	Palette,
	PanelRightDashed,
	Pause,
	PenTool,
	Pipette,
	Play,
	Plus,
	RotateCcw,
	RotateCw,
	Rows3,
	Ruler,
	Scissors,
	Search,
	Settings,
	Settings2,
	SlidersHorizontal,
	Smile,
	SmilePlus,
	Snowflake,
	Sparkles,
	Square,
	Table,
	ToggleLeft,
	Trash2,
	TriangleAlert,
	Type,
	Undo2,
	Unlink,
	Upload,
	Video,
	Volume2,
	VolumeOff,
	VolumeX,
	WandSparkles,
	X,
	Zap,
	ZoomIn,
	ZoomOut,
	type LucideIcon,
} from "lucide-react";

export type IconSvgElement = LucideIcon | ComponentType<{ className?: string }>;

export interface HugeiconsIconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "color"> {
	icon: IconSvgElement;
	size?: number | string;
	strokeWidth?: number;
	color?: string;
}

export function HugeiconsIcon({
	icon,
	size: _size,
	strokeWidth: _strokeWidth,
	color: _color,
	...props
}: HugeiconsIconProps) {
	const Icon = icon as ComponentType<SVGProps<SVGSVGElement>>;
	return <Icon aria-hidden {...props} />;
}

export const Alert02Icon = TriangleAlert;
export const AlertCircleIcon = CircleAlert;
export const AlignLeftIcon = AlignLeft;
export const AlignRightIcon = AlignRight;
export const ArrowDown01Icon = ChevronDown;
export const ArrowDownIcon = ArrowDown;
export const ArrowExpandIcon = Expand;
export const ArrowRightDoubleIcon = ChevronsRight;
export const ArrowRightIcon = ArrowRight;
export const ArrowTurnBackwardIcon = Undo2;
export const ArrowUpIcon = ArrowUp;
export const Bookmark02Icon = Bookmark;
export const Cancel01Icon = X;
export const Chart03Icon = ChartSpline;
export const CircleIcon = Circle;
export const ClearIcon = Eraser;
export const ClosedCaptionIcon = Captions;
export const CloudUploadIcon = CloudUpload;
export const ColorPickerIcon = Pipette;
export const ColorsIcon = Palette;
export const Copy01Icon = Copy;
export const DashboardSpeed02Icon = Gauge;
export const Delete02Icon = Trash2;
export const DiamondIcon = Diamond;
export const Exchange01Icon = ArrowLeftRight;
export const FavouriteIcon = Heart;
export const FeatherIcon = Feather;
export const FilterMailIcon = Filter;
export const Folder03Icon = Folder;
export const FullScreenIcon = Maximize;
export const GridTableIcon = Table;
export const GridViewIcon = LayoutGrid;
export const Happy01Icon = Smile;
export const HappyIcon = SmilePlus;
export const HeadphonesIcon = Headphones;
export const Image02Icon = Image;
export const KeyframeIcon = Diamond;
export const Layers01Icon = Layers;
export const LayoutThreeColumnIcon = Columns3;
export const LayoutThreeRowIcon = Rows3;
export const LeftToRightListDashIcon = ListEnd;
export const Link02Icon = Link;
export const Loading03Icon = LoaderCircle;
export const MagicWand05Icon = WandSparkles;
export const MagnetIcon = Magnet;
export const MinusSignIcon = Minus;
export const MusicNote03Icon = Music;
// Misty: the shots of a video, for "Mark the shots".
export const Film01Icon = Film;
export const PanelRightDashedIcon = PanelRightDashed;
export const PauseIcon = Pause;
export const PenToolAddIcon = PenTool;
export const PlayIcon = Play;
export const PlusSignIcon = Plus;
export const RainDropIcon = Droplet;
export const Rotate01Icon = RotateCcw;
export const RotateClockwiseIcon = RotateCw;
export const RulerIcon = Ruler;
export const ScissorIcon = Scissors;
export const Search01Icon = Search;
export const SearchAddIcon = ZoomIn;
export const SearchMinusIcon = ZoomOut;
export const Settings01Icon = Settings;
export const Settings05Icon = Settings2;
export const SlidersHorizontalIcon = SlidersHorizontal;
export const SnowIcon = Snowflake;
export const SortingOneNineIcon = ArrowDown01;
export const SquareIcon = Square;
export const StarsIcon = Sparkles;
export const TaskAdd02Icon = ListPlus;
export const TextFontIcon = CaseSensitive;
export const TextIcon = Type;
export const Tick02Icon = Check;
export const TrackIcon = GalleryHorizontal;
export const TrackToggleIcon = ToggleLeft;
export const TransitionTopIcon = ArrowUpToLine;
export const TriggerIcon = Zap;
export const Unlink02Icon = Unlink;
export const UploadIcon = Upload;
export const Video01Icon = Video;
export const ViewIcon = Eye;
export const ViewOffSlashIcon = EyeOff;
export const VolumeHighIcon = Volume2;
export const VolumeMute02Icon = VolumeX;
export const VolumeOffIcon = VolumeOff;
