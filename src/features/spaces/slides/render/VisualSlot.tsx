import { lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import type { ItemVisibility } from "../../api/visibility";
import type { VisualSlotSpec } from "../deck/layouts";
import { screenColor, fontStack, type DeckTheme } from "../deck/themes";
import type { SlotEmbed } from "../deck/types";
import { boxStyle, reactStyle } from "../deck/slotStyle";
import { useDeckAssetUrl } from "./renderHooks";

const LiveEmbed = lazy(() =>
  import("@/features/spaces/embeds").then((module) => ({ default: module.LiveEmbed })),
);

/** How a live embed is drawn: live (stage, present), or a stand-in naming it (thumbnails). */
export type EmbedMode = "live" | "still";

/**
 * Live embeds lay out at half the slide's pixels and are drawn twice as large, so a chart's own
 * labels read at their usual size on a slide shown at about half scale.
 */
const EMBED_ZOOM = 2;

export function VisualSlot(props: {
  spec: VisualSlotSpec;
  embed: SlotEmbed | null;
  theme: DeckTheme;
  spaceId: string;
  deckId: string;
  hostVisibility?: ItemVisibility;
  embedMode: EmbedMode;
  /** Whether an empty slot shows where its visual goes (not in present mode). */
  showEmpty: boolean;
}) {
  const { spec, embed, theme } = props;
  const radius = spec.bleed ? 0 : theme.spacing.radius;
  const frame: CSSProperties = {
    ...reactStyle(boxStyle(spec.box)),
    borderRadius: `${radius}px`,
    overflow: "hidden",
  };
  if (!embed) {
    if (!props.showEmpty) return null;
    return (
      <div
        style={{
          ...frame,
          border: `3px dashed ${screenColor(theme, "line")}`,
        }}
      />
    );
  }
  if (embed.type === "image") {
    return (
      <div style={{ ...frame, background: screenColor(theme, "line") }}>
        <DeckImage
          spaceId={props.spaceId}
          deckId={props.deckId}
          assetId={embed.asset_id}
          focalX={embed.focal_x ?? 0.5}
          focalY={embed.focal_y ?? 0.5}
        />
      </div>
    );
  }
  const stand = <EmbedStandIn theme={theme} title={embed.title} type={embed.type} />;
  return (
    <div style={{ ...frame, ...seriesVariables(theme) }}>
      {props.embedMode === "still" ? (
        stand
      ) : (
        <div
          style={{
            width: `${spec.box.w / EMBED_ZOOM}px`,
            height: `${spec.box.h / EMBED_ZOOM}px`,
            transform: `scale(${EMBED_ZOOM})`,
            transformOrigin: "0 0",
          }}
        >
          <Suspense fallback={stand}>
            <LiveEmbed
              spaceId={props.spaceId}
              embed={{
                kind: embed.type,
                item_id: embed.item_id,
                part_id: embed.part_id,
                title: embed.title,
              }}
              hostVisibility={props.hostVisibility ?? "public"}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function DeckImage(props: {
  spaceId: string;
  deckId: string;
  assetId: string;
  focalX: number;
  focalY: number;
}) {
  const asset = useDeckAssetUrl(props.spaceId, props.deckId, props.assetId);
  if (!asset.url) return null;
  return (
    <img
      src={asset.url}
      alt=""
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${props.focalX * 100}% ${props.focalY * 100}%`,
        display: "block",
      }}
    />
  );
}

/** A chart or frame drawn as its name, for thumbnails and while the live part loads. */
function EmbedStandIn(props: { theme: DeckTheme; title: string; type: string }): ReactNode {
  const { theme } = props;
  const what =
    props.type === "data-chart"
      ? "Chart"
      : props.type === "data-range"
        ? "Table"
        : "Whiteboard frame";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: "16px",
        border: `3px solid ${screenColor(theme, "line")}`,
        borderRadius: "inherit",
        color: screenColor(theme, "soft"),
        fontFamily: fontStack(theme.body),
        fontSize: "40px",
        textAlign: "center",
        padding: "48px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: "28px" }}>{what}</div>
      <div style={{ color: screenColor(theme, "text") }}>{props.title}</div>
    </div>
  );
}

/** The deck's chart colors, for a live chart that reads them. */
export function seriesVariables(theme: DeckTheme): CSSProperties {
  const variables: Record<string, string> = {};
  theme.series.forEach((color, index) => {
    variables[`--chart-series-${index + 1}`] = color;
  });
  variables["--chart-text"] = screenColor(theme, "text");
  variables["--chart-soft"] = screenColor(theme, "soft");
  variables["--chart-line"] = screenColor(theme, "line");
  return variables as CSSProperties;
}
