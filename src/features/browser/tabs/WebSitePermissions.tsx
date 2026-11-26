import { Lock, LockOpen, X } from "lucide-react";
import { useState } from "react";
import {
  Button,
  IconButton,
  OptionSelect,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverText,
  PopoverTrigger,
  QuestionPanel,
  RowGroup,
  SettingsRow,
} from "@misty/ui";
import { shownAddress } from "./web_address";
import {
  answerPermission,
  askedFor,
  readSitePermissions,
  setSitePermission,
  sitePermissionKinds,
  sitePermissionName,
  useWebPermissionAsks,
  type SitePermissionKind,
  type SitePermissions,
} from "./web_permissions";

const hostOf = (origin: string) => shownAddress(origin).host || origin;

export function WebPermissionAsk(props: { viewId: string }) {
  const ask = useWebPermissionAsks((state) =>
    props.viewId ? state.asks.find((item) => item.page === props.viewId) : undefined,
  );
  if (!ask) return null;
  return (
    <div className="px-3 pt-3">
      <QuestionPanel
        label="A site is asking"
        title={`${hostOf(ask.origin)} wants to ${askedFor(ask.kinds)}`}
        end={
          <IconButton
            size="sm"
            label="Dismiss"
            onClick={() => answerPermission(ask.id, false, false)}
          >
            <X />
          </IconButton>
        }
        actions={
          <>
            <Button variant="primary" onClick={() => answerPermission(ask.id, true, true)}>
              Allow
            </Button>
            <Button variant="secondary" onClick={() => answerPermission(ask.id, false, true)}>
              Don't allow
            </Button>
          </>
        }
      />
    </div>
  );
}

const choiceOf = (value: boolean | undefined) =>
  value === true ? "allow" : value === false ? "block" : "ask";

const choices = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "block", label: "Block" },
];

export function WebSiteInfo(props: { url: string }) {
  const [permissions, setPermissions] = useState<SitePermissions>({});
  let origin = "";
  let secure = false;
  try {
    const parsed = new URL(props.url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      origin = parsed.origin;
      secure = parsed.protocol === "https:";
    }
  } catch {
    origin = "";
  }
  if (!origin) return null;
  const load = (open: boolean) => {
    if (open) void readSitePermissions(origin).then(setPermissions);
  };
  const change = (kind: SitePermissionKind, value: string) => {
    const allow = value === "allow" ? true : value === "block" ? false : null;
    setPermissions((current) => ({ ...current, [kind]: allow ?? undefined }));
    void setSitePermission(origin, kind, allow).catch(
      () => void readSitePermissions(origin).then(setPermissions),
    );
  };
  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <IconButton label="Site information">{secure ? <Lock /> : <LockOpen />}</IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" size="lg">
        <PopoverHeader title={hostOf(origin)} close />
        <PopoverText>{secure ? "Connection is secure." : "Connection isn't secure."}</PopoverText>
        <PopoverBody>
          <RowGroup>
            {sitePermissionKinds.map((kind) => (
              <SettingsRow key={kind} label={sitePermissionName[kind]}>
                <OptionSelect
                  aria-label={sitePermissionName[kind]}
                  value={choiceOf(permissions[kind])}
                  options={choices}
                  onValueChange={(value) => change(kind, value)}
                />
              </SettingsRow>
            ))}
          </RowGroup>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
