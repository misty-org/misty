// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/ui/components/
// StatusAwareAvatar.tsx, BaseAvatar.tsx and AvatarStatusLayout.ts, with the status geometry of
// scripts/GenerateAvatarMasks.ts (STATUS_CONFIG) and the presence shapes it draws. Someone without
// a picture wears Misty's initials in their own tone, as everywhere else in Misty.
import type { CSSProperties } from "react";
import { personColor } from "@/features/agents";
import { personInitials } from "@/shared/lib/personInitials";

export type FluxerPresence = "online" | "idle" | "dnd" | "offline";

/** [status dot size, notch radius, notch centre] per avatar size, from STATUS_CONFIG. */
const statusConfig: Record<number, [number, number, number]> = {
  20: [10, 6, 17],
  24: [10, 7, 20],
  32: [10, 8, 27],
  36: [10, 8, 30],
  40: [12, 9, 34],
  44: [14, 10, 38],
  48: [14, 10, 42],
  56: [16, 11, 49],
  80: [16, 11.2, 68],
  120: [24, 16.8, 100],
};

const statusColor: Record<FluxerPresence, string> = {
  online: "var(--status-online)",
  idle: "var(--status-idle)",
  dnd: "var(--status-dnd)",
  offline: "var(--status-offline)",
};

/** The presence shapes (flx-mask-presence-*), on a 1×1 box. */
function PresenceDot(props: { status: FluxerPresence; size: number; style: CSSProperties }) {
  const fill = statusColor[props.status];
  const shape =
    props.status === "idle" ? (
      <path
        fillRule="evenodd"
        d="M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0Z M0.25 -0.125A0.375 0.375 0 1 0 0.25 0.625A0.375 0.375 0 1 0 0.25 -0.125Z"
      />
    ) : props.status === "dnd" ? (
      <path
        fillRule="evenodd"
        d="M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0Z M0.25 0.375H0.75A0.125 0.125 0 0 1 0.75 0.625H0.25A0.125 0.125 0 0 1 0.25 0.375Z"
      />
    ) : props.status === "offline" ? (
      <path
        fillRule="evenodd"
        d="M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0Z M0.5 0.25A0.25 0.25 0 1 0 0.5 0.75A0.25 0.25 0 1 0 0.5 0.25Z"
      />
    ) : (
      <circle cx="0.5" cy="0.5" r="0.5" />
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1 1"
      width={props.size}
      height={props.size}
      style={{ position: "absolute", fill, ...props.style }}
    >
      {shape}
    </svg>
  );
}

/**
 * A round picture with Fluxer's presence: the dot sits in a notch cut out of the picture, so
 * whatever is behind the row (its hover wash) shows through as a 3px gap, never a stroke.
 */
export function FluxerAvatar(props: {
  id: string;
  name: string;
  size: number;
  src?: string;
  status?: FluxerPresence;
  className?: string;
}) {
  const config = statusConfig[props.size];
  const status = config && props.status ? props.status : undefined;
  const notch =
    status && config
      ? `radial-gradient(circle ${config[1]}px at ${config[2]}px ${config[2]}px, transparent 99%, #000 100%)`
      : undefined;
  const face: CSSProperties = {
    display: "block",
    width: props.size,
    height: props.size,
    borderRadius: "50%",
    maskImage: notch,
    WebkitMaskImage: notch,
  };
  return (
    <span
      className={props.className}
      style={{
        position: "relative",
        display: "block",
        flexShrink: 0,
        width: props.size,
        height: props.size,
      }}
    >
      {props.src ? (
        <img
          src={props.src}
          alt=""
          draggable={false}
          style={{
            ...face,
            objectFit: "cover",
            backgroundColor: "var(--background-secondary-alt)",
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            ...face,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: personColor(props.id),
            color: "var(--color-ink-on-color, #202124)",
            fontSize: Math.max(7, Math.round(props.size * 0.42)),
            fontWeight: 500,
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {props.size >= 20 ? personInitials(props.name) : null}
        </span>
      )}
      {status && config ? (
        <PresenceDot
          status={status}
          size={config[0]}
          style={{ left: config[2] - config[0] / 2, top: config[2] - config[0] / 2 }}
        />
      ) : null}
      <span className="sr-only">{props.name}</span>
    </span>
  );
}
