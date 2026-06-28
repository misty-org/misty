import { useEffect, useMemo, useState } from "react";
import {
  providersBackendActions,
  providersConfigSecurity,
  providersCreatePublicLink,
  providersHardenConfig,
  providersJobStatus,
  providersPublicLinks,
  providersRepairConfigSecurity,
  providersRevokePublicLink,
  providersRunBackendAction,
  providersVerifyResult,
  providersVerifyStart,
} from "../../../api/misty";
import type {
  BackendAction,
  ConfigSecurityStatus,
  ProviderJobStatus,
  PublicLinkRecord,
  RemoteEditDraft,
  VerifyResult,
} from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useSettingsStore } from "../../settings/useSettingsStore";
import { defaultTransferProfile, defaultTransferProfileId, transferProfileOptions, transferProfileRecords } from "../../settings/transferProfiles";

const sectionClass = "grid gap-3 border-t border-[var(--misty-border)] px-[18px] py-4";
const sectionHeaderClass = "flex items-center justify-between gap-3";
const titleClass = "text-[13px] font-semibold text-[var(--misty-text)]";
const mutedClass = "text-xs text-[var(--misty-text-muted)]";
const fieldGridClass = "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2";
const inputClass =
  "min-h-8 rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 text-[13px] text-[var(--misty-text)] outline-none focus:border-[var(--misty-accent)]";
const selectClass = `${inputClass} appearance-none`;
const buttonClass =
  "inline-flex min-h-8 items-center justify-center rounded-[7px] border border-[var(--misty-border)] bg-[var(--misty-surface)] px-3 text-[13px] text-[var(--misty-text)] hover:bg-[var(--misty-surface-hover)] disabled:opacity-50";
const primaryButtonClass =
  "inline-flex min-h-8 items-center justify-center rounded-[7px] border border-[color-mix(in_srgb,var(--misty-accent)_55%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-accent)_15%,var(--misty-surface))] px-3 text-[13px] text-[var(--misty-accent)] hover:bg-[color-mix(in_srgb,var(--misty-accent)_22%,var(--misty-surface))] disabled:opacity-50";
const resultClass =
  "max-h-40 overflow-auto rounded-[7px] border border-[var(--misty-border)] bg-[rgba(0,0,0,0.18)] p-2.5 text-xs text-[var(--misty-text-muted)]";

interface RemotePowerToolsProps {
  draft: RemoteEditDraft;
  working: boolean;
}

type EndpointKind = "remote" | "local";

export function RemotePowerTools(props: RemotePowerToolsProps) {
  const remote = props.draft.originalName;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyJob, setVerifyJob] = useState<ProviderJobStatus | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [sourceKind, setSourceKind] = useState<EndpointKind>("remote");
  const [sourcePath, setSourcePath] = useState("/");
  const [destKind, setDestKind] = useState<EndpointKind>("local");
  const [destPath, setDestPath] = useState("");
  const [verifyProfileId, setVerifyProfileId] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [links, setLinks] = useState<PublicLinkRecord[]>([]);
  const [actions, setActions] = useState<BackendAction[]>([]);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [security, setSecurity] = useState<ConfigSecurityStatus | null>(null);
  const [securityPassword, setSecurityPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const settingsDocument = useSettingsStore((state) => state.settings?.document ?? {});
  const transferProfiles = useMemo(() => transferProfileRecords(settingsDocument), [settingsDocument]);
  const savedProfileId = useMemo(() => defaultTransferProfileId(settingsDocument), [settingsDocument]);
  const selectedProfile = transferProfiles.find((profile) => profile.id === verifyProfileId) ?? defaultTransferProfile(settingsDocument);

  useEffect(() => {
    setMessage(null);
    setError(null);
    setVerifyJob(null);
    setVerifyResult(null);
    setActionResult(null);
    void refreshLinks(remote, linkPath, setLinks, setMessage, setError);
    void providersBackendActions(remote).then(setActions).catch((cause) => setError(errorText(cause)));
    void providersConfigSecurity().then(setSecurity).catch(() => undefined);
  }, [remote]);

  useEffect(() => {
    if (verifyProfileId && transferProfiles.some((profile) => profile.id === verifyProfileId)) return;
    setVerifyProfileId(savedProfileId);
  }, [savedProfileId, transferProfiles, verifyProfileId]);

  useEffect(() => {
    if (!verifyJob || verifyJob.state !== "running") return;
    const timer = window.setInterval(() => {
      void providersJobStatus(verifyJob.jobId)
        .then((next) => {
          setVerifyJob(next);
          if (next.resultReady) {
            return providersVerifyResult(next.jobId).then(setVerifyResult);
          }
        })
        .catch((cause) => setError(errorText(cause)));
    }, 900);
    return () => window.clearInterval(timer);
  }, [verifyJob]);

  const verifySummary = useMemo(() => {
    if (!verifyResult) return null;
    const issues = verifyResult.missingOnSrc.length + verifyResult.missingOnDst.length + verifyResult.differ.length + verifyResult.error.length;
    if (verifyResult.success && issues === 0) return "No differences found.";
    return `${issues} ${issues === 1 ? "issue" : "issues"} found.`;
  }, [verifyResult]);

  const runVerify = async () => {
    setBusy("verify");
    setError(null);
    setMessage(null);
    setVerifyResult(null);
    try {
      const started = await providersVerifyStart({
        source: { kind: sourceKind, remote: sourceKind === "remote" ? remote : undefined, path: sourcePath },
        dest: { kind: destKind, remote: destKind === "remote" ? remote : undefined, path: destPath },
        options: { profile: transferProfileOptions(selectedProfile) },
      });
      const status = await providersJobStatus(started.jobId);
      setVerifyJob(status);
      setMessage("Verify started.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const createLink = async () => {
    setBusy("link");
    setError(null);
    try {
      const result = await providersCreatePublicLink({ remote, path: linkPath });
      if (result.link) setLinks((current) => [result.link!, ...current.filter((link) => link.id !== result.link!.id)]);
      setMessage(result.message ?? "Link updated.");
      void refreshLinks(remote, linkPath, setLinks, setMessage, setError);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const revokeLink = async (link: PublicLinkRecord) => {
    setBusy(`revoke:${link.id}`);
    setError(null);
    try {
      const result = await providersRevokePublicLink({ remote, path: link.path || linkPath, linkId: link.id, targetId: link.targetId ?? undefined });
      setLinks((current) => current.filter((item) => item.id !== link.id));
      setMessage(result.message ?? "Link revoked.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (action: BackendAction) => {
    setBusy(action.id);
    setError(null);
    try {
      const result = await providersRunBackendAction({ remote, actionId: action.id });
      setActionResult(result.result);
      setMessage(`${result.label} finished.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const hardenConfig = async () => {
    setBusy("security");
    setError(null);
    try {
      const next = await providersHardenConfig();
      setSecurity(next);
      setMessage(next.message ?? "Config security updated.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const repairConfigSecurity = async () => {
    setBusy("security-repair");
    setError(null);
    try {
      const next = await providersRepairConfigSecurity(securityPassword);
      setSecurity(next);
      setSecurityPassword("");
      setMessage(next.message ?? "Config unlock repaired.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <div className={titleClass}>Verify</div>
            <div className={mutedClass}>Compare any local or provider path.</div>
          </div>
          <button className={primaryButtonClass} type="button" disabled={props.working || busy === "verify" || !sourcePath || !destPath} onClick={() => void runVerify()}>
            Verify
          </button>
        </div>
        <EndpointFields label="Source" kind={sourceKind} path={sourcePath} onKind={setSourceKind} onPath={setSourcePath} />
        <EndpointFields label="Against" kind={destKind} path={destPath} onKind={setDestKind} onPath={setDestPath} />
        <div className={fieldGridClass}>
          <span className={mutedClass}>Profile</span>
          <select className={selectClass} value={selectedProfile.id} onChange={(event) => setVerifyProfileId(event.target.value)}>
            {transferProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </div>
        {verifyJob ? <div className={mutedClass}>{verifyJob.phase || verifyJob.state}{verifyJob.message ? ` · ${verifyJob.message}` : ""}</div> : null}
        {verifySummary ? <pre className={resultClass}>{verifySummary}{"\n"}{JSON.stringify(verifyResult, null, 2)}</pre> : null}
      </section>

      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <div className={titleClass}>Shared Links</div>
            <div className={mutedClass}>Review and create public links for supported providers.</div>
          </div>
          <button className={primaryButtonClass} type="button" disabled={props.working || busy === "link" || !linkPath} onClick={() => void createLink()}>
            Create Link
          </button>
        </div>
        <div className={fieldGridClass}>
          <span className={mutedClass}>Path</span>
          <input
            className={inputClass}
            value={linkPath}
            placeholder="All shared links"
            onChange={(event) => setLinkPath(event.target.value)}
            onBlur={() => void refreshLinks(remote, linkPath, setLinks, setMessage, setError)}
          />
        </div>
        {links.length > 0 ? (
          <div className="grid gap-2">
            {links.map((link) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border border-[var(--misty-border)] bg-[rgba(0,0,0,0.18)] p-2.5" key={link.id || link.url}>
                <div className="min-w-0">
                  <div className="truncate text-xs text-[var(--misty-text)]">{link.url}</div>
                  {link.path ? <div className={mutedClass}>{link.path}</div> : null}
                  <div className={mutedClass}>{[link.role, link.scope, link.kind, link.expiresAt ? `expires ${link.expiresAt}` : ""].filter(Boolean).join(" · ")}</div>
                </div>
                <button className={buttonClass} type="button" disabled={!link.canRevoke || busy === `revoke:${link.id}`} onClick={() => void revokeLink(link)}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={sectionClass}>
        <div>
          <div className={titleClass}>Provider Actions</div>
          <div className={mutedClass}>Run curated maintenance and information actions.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button key={action.id} className={buttonClass} type="button" disabled={props.working || busy === action.id} title={action.description} onClick={() => void runAction(action)}>
              {action.label}
            </button>
          ))}
        </div>
        {actionResult ? <pre className={resultClass}>{JSON.stringify(actionResult, null, 2)}</pre> : null}
      </section>

      <section className={sectionClass}>
        <div className={sectionHeaderClass}>
          <div>
            <div className={titleClass}>Config Security</div>
            <div className={mutedClass}>{security?.message ?? "Check local provider config encryption."}</div>
          </div>
          <button className={buttonClass} type="button" disabled={props.working || busy === "security"} onClick={() => void hardenConfig()}>
            Encrypt
          </button>
        </div>
        {security ? <div className={mutedClass}>{security.encrypted ? "Encrypted" : "Not encrypted"} · {security.passwordPresent ? "Keychain ready" : "No Keychain item"}</div> : null}
        {security?.encrypted && !security.passwordPresent ? (
          <div className={fieldGridClass}>
            <span className={mutedClass}>Repair</span>
            <div className="flex min-w-0 gap-2">
              <input
                className={`${inputClass} min-w-0 flex-1`}
                value={securityPassword}
                type="password"
                placeholder="Existing config passphrase"
                onChange={(event) => setSecurityPassword(event.target.value)}
              />
              <button className={buttonClass} type="button" disabled={props.working || busy === "security-repair" || !securityPassword.trim()} onClick={() => void repairConfigSecurity()}>
                Repair
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {message ? <div className="px-[18px] pb-3 text-xs text-[var(--misty-success)]">{message}</div> : null}
      {error ? <div className="px-[18px] pb-3 text-xs text-[var(--misty-danger)]">{error}</div> : null}
    </div>
  );
}

function EndpointFields(props: {
  label: string;
  kind: EndpointKind;
  path: string;
  onKind: (kind: EndpointKind) => void;
  onPath: (path: string) => void;
}) {
  return (
    <div className={fieldGridClass}>
      <span className={mutedClass}>{props.label}</span>
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
        <select className={selectClass} value={props.kind} onChange={(event) => props.onKind(event.target.value as EndpointKind)}>
          <option value="remote">Remote</option>
          <option value="local">Local</option>
        </select>
        <input className={inputClass} value={props.path} placeholder={props.kind === "local" ? "/Users/..." : "/"} onChange={(event) => props.onPath(event.target.value)} />
      </div>
    </div>
  );
}

async function refreshLinks(
  remote: string,
  path: string,
  setLinks: (links: PublicLinkRecord[]) => void,
  setMessage: (message: string | null) => void,
  setError: (message: string | null) => void,
) {
  try {
    const result = await providersPublicLinks({ remote, path });
    setLinks(result.links);
    if (result.message) setMessage(result.message);
  } catch (cause) {
    setError(errorText(cause));
  }
}
