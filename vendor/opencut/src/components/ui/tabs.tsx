// Misty: OpenCut's Tabs drawn as Misty's Segment tabs (a track, the open tab lifted out of it).
import {
	createContext,
	useContext,
	useId,
	useState,
	type ReactNode,
} from "react";
import { Segment, SegmentTrack } from "@/shared/ui";

type TabsState = { value: string; select: (value: string) => void; id: string };
const TabsContext = createContext<TabsState | null>(null);

function useTabs(): TabsState {
	const state = useContext(TabsContext);
	if (!state) throw new Error("Tabs parts must be inside <Tabs>.");
	return state;
}

export function Tabs({
	value,
	defaultValue = "",
	onValueChange,
	className,
	children,
}: {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	className?: string;
	variant?: string;
	children?: ReactNode;
}) {
	const [own, setOwn] = useState(defaultValue);
	const id = useId();
	const current = value ?? own;
	const select = (next: string) => {
		if (value === undefined) setOwn(next);
		onValueChange?.(next);
	};
	return (
		<TabsContext.Provider value={{ value: current, select, id }}>
			<div className={className}>{children}</div>
		</TabsContext.Provider>
	);
}

export function TabsList({ className, children }: { className?: string; children?: ReactNode }) {
	return (
		<div className={className}>
			<SegmentTrack role="tablist">{children}</SegmentTrack>
		</div>
	);
}

export function TabsTrigger({
	value,
	children,
	disabled,
}: {
	value: string;
	children?: ReactNode;
	className?: string;
	disabled?: boolean;
}) {
	const tabs = useTabs();
	const selected = tabs.value === value;
	return (
		<Segment
			role="tab"
			id={`${tabs.id}-tab-${value}`}
			aria-selected={selected}
			aria-controls={`${tabs.id}-panel-${value}`}
			data-state={selected ? "active" : "inactive"}
			disabled={disabled}
			onClick={() => tabs.select(value)}
		>
			{children}
		</Segment>
	);
}

export function TabsContent({
	value,
	className,
	children,
}: {
	value: string;
	className?: string;
	children?: ReactNode;
}) {
	const tabs = useTabs();
	if (tabs.value !== value) return null;
	return (
		<div
			role="tabpanel"
			id={`${tabs.id}-panel-${value}`}
			aria-labelledby={`${tabs.id}-tab-${value}`}
			className={className}
		>
			{children}
		</div>
	);
}
