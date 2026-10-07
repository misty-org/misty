import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton, Input } from "@/shared/ui";
import { bangNames, mistyBangs } from "@/features/browser-workspace/bangs";
import {
  customBangProblem,
  parseBrowserCustomBangs,
  type BrowserCustomBang,
} from "@/features/workspace/browserSearchEngine";
import { DesktopSettingsSection as SettingsSectionBlock } from "../components/DesktopSettingsUI";
import {
  settingsAssociationRowClass,
  settingsDisabledControlClass,
  settingsEmptyClass,
  settingsReferenceHeaderClass,
  settingsReferenceListClass,
  settingsReferenceSpanClass,
} from "../settingsConstants";
import { stringSetting } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

const key = "browser_custom_bangs_json";
const reserved = new Map(
  mistyBangs.flatMap((bang) => bangNames(bang).map((name) => [name, bang] as const)),
);
const emptyDraft: BrowserCustomBang = { trigger: "", name: "", url: "" };

/** The person's own `!name` search shortcuts, saved to their account. */
export function BrowserBangsSettings(
  props: Pick<SettingsContentProps, "document" | "working" | "onSettingChange">,
) {
  const bangs = parseBrowserCustomBangs(stringSetting(props.document, "general", key, "[]"));
  const [draft, setDraft] = useState(emptyDraft);
  const [problem, setProblem] = useState<string | null>(null);
  const save = (next: BrowserCustomBang[]) =>
    props.onSettingChange("general", key, JSON.stringify(next));

  const add = () => {
    const bang = {
      trigger: draft.trigger.trim().replace(/^!/, "").toLowerCase(),
      name: draft.name.trim(),
      url: draft.url.trim(),
    };
    const taken = reserved.get(bang.trigger);
    const issue = taken
      ? `!${bang.trigger} already searches ${taken.label}.`
      : bangs.some((existing) => existing.trigger === bang.trigger)
        ? `You already have !${bang.trigger}.`
        : customBangProblem(bang);
    setProblem(issue);
    if (issue) return;
    save([...bangs, bang]);
    setDraft(emptyDraft);
  };

  const field = (name: keyof BrowserCustomBang, label: string, placeholder: string) => (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={draft[name]}
      disabled={props.working}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        setProblem(null);
        setDraft({ ...draft, [name]: event.target.value });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") add();
      }}
    />
  );

  return (
    <SettingsSectionBlock
      title="Search shortcuts"
      description="Type ! in search to see every shortcut. Yours replace a built-in site with the same name."
    >
      <div className={settingsReferenceListClass}>
        <div className={`${settingsAssociationRowClass} ${settingsReferenceHeaderClass}`}>
          <span>Shortcut</span>
          <span>Searches</span>
          <span />
        </div>
        {bangs.map((bang) => (
          <div className={settingsAssociationRowClass} key={bang.trigger}>
            <span className={`${settingsReferenceSpanClass} font-mono text-xs`}>
              !{bang.trigger}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{bang.name}</span>
              <span className="block truncate text-xs text-cream-muted" title={bang.url}>
                {bang.url}
              </span>
            </span>
            <IconButton
              variant="destructive"
              label={`Remove !${bang.trigger}`}
              className={settingsDisabledControlClass}
              disabled={props.working}
              onClick={() => save(bangs.filter((item) => item.trigger !== bang.trigger))}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
        {bangs.length === 0 ? (
          <p className={settingsEmptyClass}>No shortcuts of your own yet.</p>
        ) : null}
        <div className="grid gap-2 px-5 py-3 @[640px]/settings:grid-cols-[110px_minmax(0,0.6fr)_minmax(0,1fr)_auto]">
          {field("trigger", "Shortcut name", "jira")}
          {field("name", "Site name", "Jira")}
          {field("url", "Search address", "https://example.com/search?q=%s")}
          <Button variant="outline" disabled={props.working} onClick={add}>
            Add
          </Button>
        </div>
        {problem ? (
          <p role="alert" className="px-5 pb-3 text-sm text-cream-muted">
            {problem}
          </p>
        ) : null}
      </div>
    </SettingsSectionBlock>
  );
}
