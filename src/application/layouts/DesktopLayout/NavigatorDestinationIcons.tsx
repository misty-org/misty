import type { SVGProps } from "react";

type DestinationIconProps = SVGProps<SVGSVGElement>;

function iconProps(props: DestinationIconProps, feature: string) {
  return {
    ...props,
    viewBox: "0 0 24 24",
    fill: "none",
    focusable: "false" as const,
    "aria-hidden": props["aria-hidden"] ?? true,
    "data-navigator-feature-icon": feature,
  };
}

export function NotesDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "notes")}>
      <path d="M6.75 3.25h10.5A1.75 1.75 0 0 1 19 5v14.25H6.75z" fill="#8B5CF6" opacity=".22" />
      <path
        d="M7 3.25h10.25A1.75 1.75 0 0 1 19 5v14.25H7a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z"
        stroke="#A78BFA"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.25v16M11 8h5M11 12h5"
        stroke="#C4B5FD"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DrawingsDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "drawings")}>
      <path
        d="m5 19 1.25-5.25L16.9 3.1a1.55 1.55 0 0 1 2.2 0l1.8 1.8a1.55 1.55 0 0 1 0 2.2L10.25 17.75Z"
        fill="#F43F5E"
        opacity=".18"
      />
      <path
        d="m5 19 1.25-5.25L16.9 3.1a1.55 1.55 0 0 1 2.2 0l1.8 1.8a1.55 1.55 0 0 1 0 2.2L10.25 17.75 5 19Z"
        stroke="#FB7185"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m14.75 5.25 4 4M6.25 13.75l4 4" stroke="#FDBA74" strokeWidth="1.7" />
      <circle cx="5" cy="19" r="1.15" fill="#FBBF24" />
    </svg>
  );
}

export function TasksDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "tasks")}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" fill="#22C55E" opacity=".18" />
      <rect x="3.5" y="4" width="17" height="16" rx="3" stroke="#4ADE80" strokeWidth="1.8" />
      <path
        d="m7 9 1.5 1.5L11 8M13.5 9.25H17M7 15l1.5 1.5L11 14M13.5 15.25H17"
        stroke="#86EFAC"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgendaDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "agenda")}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" fill="#F59E0B" opacity=".18" />
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#FBBF24" strokeWidth="1.8" />
      <path
        d="M7.5 3.5v3M16.5 3.5v3M3.75 9h16.5"
        stroke="#FDBA74"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="8" cy="13" r="1" fill="#FCD34D" />
      <circle cx="12" cy="13" r="1" fill="#FCD34D" />
      <circle cx="16" cy="13" r="1" fill="#FCD34D" />
      <circle cx="8" cy="17" r="1" fill="#FCD34D" />
      <circle cx="12" cy="17" r="1" fill="#FCD34D" />
    </svg>
  );
}

export function RoadmapsDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "roadmaps")}>
      <path
        d="M6 6.5h5a3 3 0 0 1 3 3v5.75M6 17.5h5a3 3 0 0 0 3-3V9.5M14 9.5h4"
        stroke="#C084FC"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="6.5" r="2.25" fill="#7C3AED" stroke="#C4B5FD" strokeWidth="1.5" />
      <circle cx="5" cy="17.5" r="2.25" fill="#2563EB" stroke="#93C5FD" strokeWidth="1.5" />
      <circle cx="19" cy="9.5" r="2.25" fill="#7C3AED" stroke="#C4B5FD" strokeWidth="1.5" />
    </svg>
  );
}

export function ExplorerDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "explorer")}>
      <path
        d="M3.5 7.25A2.25 2.25 0 0 1 5.75 5h3l1.75 2h7.75a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25Z"
        fill="#0EA5E9"
        opacity=".2"
      />
      <path
        d="M3.5 8.5V7.25A2.25 2.25 0 0 1 5.75 5h3l1.75 2h7.75a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18.25 19H5.75a2.25 2.25 0 0 1-2.25-2.25V8.5Z"
        stroke="#38BDF8"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 11.5h3.25M9.625 10v3M14.25 14.5H18"
        stroke="#93C5FD"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TransfersDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "transfers")}>
      <path
        d="M4 8h14.5M15.5 4.75 19 8l-3.5 3.25"
        stroke="#34D399"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 16H5.5M8.5 12.75 5 16l3.5 3.25"
        stroke="#22D3EE"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="8" r="1.4" fill="#6EE7B7" />
      <circle cx="20" cy="16" r="1.4" fill="#67E8F9" />
    </svg>
  );
}

export function AllItemsDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "all-items")}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" fill="#0EA5E9" opacity=".16" />
      <rect x="3.5" y="4" width="17" height="16" rx="3" stroke="#38BDF8" strokeWidth="1.8" />
      <circle cx="8.5" cy="9" r="1.5" fill="#FBBF24" />
      <path
        d="m5.75 17 4.25-4 2.5 2 2.25-2 3.5 4"
        stroke="#A78BFA"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FavoritesDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "favorites")}>
      <path
        d="M12 20.25S4 15.5 4 9.25A4.25 4.25 0 0 1 12 7.3a4.25 4.25 0 0 1 8 1.95c0 6.25-8 11-8 11Z"
        fill="#F43F5E"
        opacity=".3"
      />
      <path
        d="M12 20.25S4 15.5 4 9.25A4.25 4.25 0 0 1 12 7.3a4.25 4.25 0 0 1 8 1.95c0 6.25-8 11-8 11Z"
        stroke="#FB7185"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 8.5a2.25 2.25 0 0 1 2.25-2.25"
        stroke="#FDA4AF"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CollectionsDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "collections")}>
      <path
        d="M3.5 8.5A2.5 2.5 0 0 1 6 6h3l1.75 2H18a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"
        fill="#F59E0B"
        opacity=".2"
      />
      <path
        d="M3.5 9.5v-1A2.5 2.5 0 0 1 6 6h3l1.75 2H18a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"
        stroke="#FBBF24"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8 3.5h3l1.5 1.75H18"
        stroke="#FDBA74"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlbumsDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "albums")}>
      <rect
        x="5"
        y="3.5"
        width="15"
        height="15"
        rx="2.5"
        fill="#2563EB"
        opacity=".2"
        stroke="#60A5FA"
        strokeWidth="1.7"
      />
      <path
        d="M16.5 20.5H6A2.5 2.5 0 0 1 3.5 18V7.5"
        stroke="#93C5FD"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="10" cy="8.5" r="1.4" fill="#FBBF24" />
      <path
        d="m7.25 16 3.5-3.25 2.25 2 1.75-1.5L18 16"
        stroke="#F472B6"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeletedDestinationIcon(props: DestinationIconProps) {
  return (
    <svg {...iconProps(props, "deleted")}>
      <path d="M6.5 7.5h11l-.75 12h-9.5Z" fill="#EF4444" opacity=".18" />
      <path
        d="M4.5 7.5h15M9 4h6l1 3.5M6.5 7.5l.75 12h9.5l.75-12"
        stroke="#F87171"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v5M14 11v5" stroke="#FCA5A5" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}
