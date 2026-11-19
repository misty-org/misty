// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/ui/tooltip/Tooltip.tsx and
// Tooltip.module.css (8px from the target, no pointer, TOOLTIP_MOTION's fade and scale from
// 0.98), on Radix's tooltip in place of Fluxer's floating-ui state machine.
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import styles from "./css/Tooltip.module.css";
import shell from "./css/SpaceChatShell.module.css";
import { cx } from "./cx";

export function FluxerTooltip(props: {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  if (!props.content) return props.children;
  return (
    <RadixTooltip.Provider delayDuration={0} skipDelayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{props.children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={props.side ?? "top"}
            sideOffset={8}
            collisionPadding={8}
            className={cx("fluxer-chat", styles.tooltip, shell.tooltipMotion)}
          >
            <div className={styles.tooltipContent}>{props.content}</div>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
