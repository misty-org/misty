// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Surface,
  Text,
} from "@/shared/ui";
import { copy } from "./copy";
import { answerProbeConfirm, currentProbeConfirm, subscribeProbeConfirm } from "./probe-confirm";
import type { McpProbePlan } from "./types";

/** An argument as a shell would need it: quoted when it holds whitespace or quotes, so the line
 *  reads as one unambiguous command. */
function displayArg(arg: string): string {
  return /[\s"'\\]/.test(arg) || arg === "" ? JSON.stringify(arg) : arg;
}

function PlanDetails({ plan }: { plan: McpProbePlan }) {
  const rows: Array<[string, string]> = [];
  if (plan.command) {
    rows.push([copy.probeConfirmCommand, [plan.command, ...plan.args].map(displayArg).join(" ")]);
  }
  if (plan.cwd) rows.push([copy.probeConfirmCwd, plan.cwd]);
  if (plan.envKeys.length > 0) rows.push([copy.probeConfirmEnv, plan.envKeys.join(", ")]);
  if (plan.url) rows.push([copy.probeConfirmUrl, plan.url]);
  if (plan.headerKeys.length > 0) rows.push([copy.probeConfirmHeaders, plan.headerKeys.join(", ")]);
  return (
    <dl className="mt-1 grid gap-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="shrink-0">
            <Text bare tone="muted">
              {label}
            </Text>
          </dt>
          <dd className="min-w-0 break-all">
            <Text bare tone="default">
              {value}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Asks before checking MCP servers whose config came with the folder (probe-confirm.ts), listing
 * the exact command or address of each so the person sees what would run. Mounted once in the
 * app. Opens without focusing Run check: running commands from a repository takes a deliberate
 * click.
 */
export function McpProbeConfirmHost() {
  const request = useSyncExternalStore(subscribeProbeConfirm, currentProbeConfirm);
  if (!request) return null;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : answerProbeConfirm(false))}>
      <AlertDialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.probeConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.probeConfirmDetail}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid max-h-72 gap-2 overflow-y-auto">
          {request.items.map(({ entry, plan }) => (
            <Surface as="li" key={entry.id} tone="well" radius="lg" className="px-3 py-2 text-sm">
              <Text bare tone="bright" weight="medium">
                {entry.name}
              </Text>
              <Text bare tone="muted" className="block break-all text-xs">
                {entry.path}
              </Text>
              {plan ? (
                <PlanDetails plan={plan} />
              ) : (
                <Text bare as="p" tone="muted" className="mt-1">
                  {copy.probeConfirmUnavailable}
                </Text>
              )}
            </Surface>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answerProbeConfirm(false)}>
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => answerProbeConfirm(true)}>
            {copy.probeConfirmRun}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
