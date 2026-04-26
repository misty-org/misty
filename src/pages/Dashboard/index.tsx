import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../AuthContext";
import { fetchMe, updateDevice, updateProfile, type MeResponse } from "./api";
import { useUserStore } from "../../store/userStore";

// ─── display helpers ─────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = { free: "Lite", pro: "Pro", max: "Max" };
const TIER_COLOR: Record<string, string> = {
  free: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  pro: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  max: "text-violet-400 bg-violet-400/10 border-violet-400/20",
};
const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  cancelled: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  expired: "text-red-400 bg-red-400/10 border-red-400/20",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

// ─── layout primitives ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-text-muted">{title}</p>
      <div className="border-y border-border/70 divide-y divide-border/60">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
      <span className="text-sm text-text-muted">{label}</span>
      <div className="text-sm text-text md:text-right">{children}</div>
    </div>
  );
}

function GhostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 py-4 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-muted italic md:text-right">{value}</span>
    </div>
  );
}

// ─── save helper ─────────────────────────────────────────────────────────────

function useSave(fn: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    setOk(false);
    try {
      await fn();
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, ok, save };
}

function SaveFeedback({ ok, error }: { ok: boolean; error: string }) {
  if (ok) return <p className="text-xs text-emerald-400 mt-2">Saved.</p>;
  if (error) return <p className="text-xs text-red-400 mt-2">{error}</p>;
  return null;
}

// ─── tabs ────────────────────────────────────────────────────────────────────

type Tab = "general" | "account" | "privacy";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy" },
];

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Section title="Appearance">
        <Row label="Theme">System</Row>
        <Row label="Language">English</Row>
        <GhostRow label="Density" value="Coming soon" />
      </Section>

      <Section title="App">
        <Row label="Version">
          <span className="font-mono text-xs text-text-muted">v0.1.0-beta</span>
        </Row>
        <Row label="Release channel">Stable</Row>
        <GhostRow label="Check for updates" value="Coming soon" />
        <GhostRow label="Auto-update" value="Coming soon" />
      </Section>

      <Section title="Notifications">
        <GhostRow label="Product updates" value="Coming soon" />
        <GhostRow label="Release notes emails" value="Coming soon" />
        <Row label="Security emails">Always on</Row>
      </Section>
    </div>
  );
}

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountPanel({
  me,
  onUpdated,
  onLogout,
}: {
  me: MeResponse;
  onUpdated: (name: string) => void;
  onLogout: () => void;
}) {
  const { patchMe } = useUserStore();
  const [name, setName] = useState(me.name);
  const [device, setDevice] = useState(me.license_device);
  const {
    saving: savingProfile,
    error: profileError,
    ok: profileOk,
    save: saveProfile,
  } = useSave(async () => {
    await updateProfile(name);
    onUpdated(name);
  });
  const {
    saving: savingDevice,
    error: deviceError,
    ok: deviceOk,
    save: saveDevice,
  } = useSave(async () => {
    await updateDevice(device);
    patchMe({ license_device: device });
  });

  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const initialsSource = name.trim() || me.name || me.email;
  const initials = initialsSource
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex flex-col gap-6">
      <Section title="License">
        <Row label="Plan">
          <Badge label={TIER_LABEL[me.tier] ?? me.tier} cls={TIER_COLOR[me.tier] ?? TIER_COLOR.free} />
        </Row>
        <Row label="Status">
          <Badge
            label={me.status.charAt(0).toUpperCase() + me.status.slice(1)}
            cls={STATUS_COLOR[me.status] ?? STATUS_COLOR.active}
          />
        </Row>
        <Row label="Type">{me.tier === "free" ? "Free forever" : "Perpetual"}</Row>
        {me.expires_at ? (
          <Row label="Expires">
            {new Date(me.expires_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Row>
        ) : me.tier !== "free" ? (
          <Row label="Expires">Never</Row>
        ) : null}
      </Section>

      <Section title="Devices">
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="space-y-1">
            <p className="text-sm text-text">Licensed device</p>
            <p className="text-xs text-text-muted">
              Change the machine name registered to your license.
            </p>
          </div>
          <div className="w-full md:max-w-sm">
            <div className="flex gap-2">
              <input
                type="text"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                placeholder="e.g. MacBook Pro"
                className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
              />
              <button
                onClick={saveDevice}
                disabled={savingDevice}
                className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                {savingDevice ? "Saving…" : "Save"}
              </button>
            </div>
            <SaveFeedback ok={deviceOk} error={deviceError} />
          </div>
        </div>

        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <div>
            <p className="text-sm font-medium text-text">{me.license_device || "Primary device"}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {TIER_LABEL[me.tier] ?? me.tier} · Activated
            </p>
          </div>
          <Badge label="Active" cls={STATUS_COLOR.active} />
        </div>

        {me.tier === "max" && (
          <div className="py-4">
            <p className="text-xs text-text-muted">
              Additional seats appear here as you activate new devices.
            </p>
          </div>
        )}

        {me.tier === "free" && (
          <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
            <p className="text-xs text-text-muted">
              Pro - $30 per device · Max - $89 unlimited devices
            </p>
            <a href="/pricing" className="shrink-0 text-xs text-text hover:text-white underline underline-offset-2 transition-colors">
              Upgrade
            </a>
          </div>
        )}
      </Section>

      <Section title="Billing">
        <GhostRow label="Payment method" value="Not connected" />
        <GhostRow label="Last payment" value="—" />
        <GhostRow label="Next invoice" value="—" />
        <div className="py-4 opacity-40">
          <button className="text-sm text-text-muted cursor-not-allowed">Manage billing →</button>
        </div>
      </Section>

      <Section title="Info">
        <div className="flex flex-col gap-4 py-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full border border-border bg-elevated flex items-center justify-center text-lg font-bold text-text shrink-0 select-none">
              {initials}
            </div>
            <div>
              <p className="text-sm font-medium text-text">{me.name}</p>
              <p className="text-xs text-text-muted mt-0.5">{me.email}</p>
              <p className="text-xs text-text-muted/50 mt-1">Photo upload — coming soon</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveProfile}
                disabled={savingProfile || name.trim() === "" || name === me.name}
                className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
              <SaveFeedback ok={profileOk} error={profileError} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Email</label>
            <input
              type="email"
              value={me.email}
              disabled
              className="w-full bg-surface/50 border border-border rounded-lg px-3 py-2 text-sm text-text-muted cursor-not-allowed"
            />
            <p className="text-xs text-text-muted/60 mt-1">Email cannot be changed.</p>
          </div>
        </div>

        <Row label="Member since">{joined}</Row>
        <Row label="User id">
          <span className="font-mono text-xs text-text-muted">{me.id}</span>
        </Row>
      </Section>

      <Section title="Security">
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <div>
            <p className="text-sm text-text">Password</p>
            <p className="text-xs text-text-muted mt-0.5">Reset via email link.</p>
          </div>
          <a href="/signin" className="text-sm text-text-muted hover:text-text underline underline-offset-2 transition-colors">
            Reset
          </a>
        </div>
        <GhostRow label="Two-factor authentication" value="Coming soon" />
        <GhostRow label="Active sessions" value="Coming soon" />
      </Section>

      <Section title="Danger Zone">
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <div>
            <p className="text-sm text-text">Sign out</p>
            <p className="text-xs text-text-muted mt-0.5">End your session on this device.</p>
          </div>
          <button onClick={onLogout} className="text-sm text-text-muted hover:text-red-400 transition-colors">
            Sign out
          </button>
        </div>
        <div className="flex flex-col gap-3 py-4 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6">
          <div>
            <p className="text-sm text-text">Delete account</p>
            <p className="text-xs text-text-muted mt-0.5">Permanently remove your account and all data.</p>
          </div>
          <button className="text-sm text-text-muted cursor-not-allowed">Delete</button>
        </div>
      </Section>
    </div>
  );
}

// ─── Privacy ─────────────────────────────────────────────────────────────────

function PrivacyPanel() {
  return (
    <div className="flex flex-col gap-6">
      <Section title="Privacy">
        <div className="py-4 flex flex-col gap-2">
          <p className="text-sm text-text font-medium">Your data stays on your device.</p>
          <p className="text-sm text-text-muted leading-relaxed">
            Misty never transmits your files or cloud credentials to any external server. All provider
            communication runs through a local proxy on your machine. We only store your account info
            (name, email, hashed password) and subscription status.
          </p>
          <a href="/docs" className="text-xs text-text-muted hover:text-text underline underline-offset-2 transition-colors mt-1 w-fit">
            Read the architecture docs →
          </a>
        </div>
      </Section>

      <Section title="Legal">
        <GhostRow label="Privacy Policy" value="Coming soon" />
        <GhostRow label="Terms of Service" value="Coming soon" />
        <GhostRow label="License Agreement" value="Coming soon" />
      </Section>

      <Section title="Data">
        <div className="flex flex-col gap-3 py-4 opacity-40 md:flex-row md:items-center md:justify-between md:gap-6">
          <div>
            <p className="text-sm text-text">Export your data</p>
            <p className="text-xs text-text-muted mt-0.5">Download a copy of your account data.</p>
          </div>
          <button className="text-sm text-text-muted cursor-not-allowed">Export</button>
        </div>
      </Section>
    </div>
  );
}

// ─── Dashboard shell ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const { me, loading, setMe, setLoading, patchMe } = useUserStore();
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    if (!user) {
      navigate("/signin", { replace: true });
      return;
    }
    if (me) return;
    setLoading(true);
    fetchMe()
      .then(setMe)
      .catch((err) => {
        if (err.status === 401) logout();
      })
      .finally(() => setLoading(false));
  }, [user, navigate, logout, me, setMe, setLoading]);

  if (!user || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-border border-t-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="pt-16">
      <div className="flex max-w-4xl mx-auto">
        {/* ── Sidebar — sticky ─────────────────────────────────── */}
        <aside className="hidden md:flex w-48 shrink-0 flex-col border-r border-border px-3 py-8 gap-1 sticky top-16 self-start h-[calc(100vh-4rem)]">
          <p className="px-3 mb-4 text-xl font-semibold text-text">Settings</p>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === id
                  ? "bg-elevated text-text font-medium"
                  : "text-text-muted hover:text-text hover:bg-elevated/50"
              }`}
            >
              {label}
            </button>
          ))}
        </aside>

        {/* ── Mobile tab bar ──────────────────────────────────── */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-bg/90 backdrop-blur flex">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-3 text-xs font-medium transition-colors ${
                tab === id ? "text-white" : "text-text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <main className="flex-1 min-w-0">
          <div className="max-w-xl px-8 py-8 pb-24 md:pb-12">
            <h1 className="text-xl font-bold text-text tracking-tight mb-6">
              {TABS.find((currentTab) => currentTab.id === tab)?.label}
            </h1>

            {tab === "general" && <GeneralPanel />}

            {me && tab === "account" && (
              <AccountPanel
                me={me}
                onUpdated={(name) => {
                  patchMe({ name });
                  setUser({ ...user, name });
                }}
                onLogout={logout}
              />
            )}

            {tab === "privacy" && <PrivacyPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
