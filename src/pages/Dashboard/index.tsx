import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../AuthContext";
import { fetchMe, updateProfile, updateDevice, type MeResponse } from "./api";

// ─── display helpers ─────────────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = { free: "Lite", pro: "Pro", max: "Max" };
const TIER_COLOR: Record<string, string> = {
  free: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  pro:  "text-blue-400  bg-blue-400/10  border-blue-400/20",
  max:  "text-violet-400 bg-violet-400/10 border-violet-400/20",
};
const STATUS_COLOR: Record<string, string> = {
  active:    "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  cancelled: "text-amber-400  bg-amber-400/10  border-amber-400/20",
  expired:   "text-red-400    bg-red-400/10    border-red-400/20",
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
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">{title}</p>
      <div className="glass-card rounded-2xl px-6 divide-y divide-border/50">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-text-muted">{label}</span>
      <div className="text-sm text-text">{children}</div>
    </div>
  );
}

function GhostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 opacity-40">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-muted italic">{value}</span>
    </div>
  );
}

// ─── save helper ─────────────────────────────────────────────────────────────

function useSave(fn: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [ok, setOk]         = useState(false);
  async function save() {
    setSaving(true); setError(""); setOk(false);
    try { await fn(); setOk(true); setTimeout(() => setOk(false), 2500); }
    catch (e: any) { setError(e.message ?? "Something went wrong"); }
    finally { setSaving(false); }
  }
  return { saving, error, ok, save };
}

function SaveFeedback({ ok, error }: { ok: boolean; error: string }) {
  if (ok)    return <p className="text-xs text-emerald-400 mt-2">Saved.</p>;
  if (error) return <p className="text-xs text-red-400 mt-2">{error}</p>;
  return null;
}

// ─── tabs ────────────────────────────────────────────────────────────────────

type Tab = "general" | "profile" | "account" | "policy";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account" },
  { id: "policy",  label: "Policy"  },
];

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPanel({ me }: { me: MeResponse }) {
  const [device, setDevice] = useState(me.license_device);
  const { saving, error, ok, save } = useSave(async () => {
    await updateDevice(device);
  });

  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">

      <Section title="Account">
        <Row label="Name">{me.name}</Row>
        <Row label="Email">{me.email}</Row>
        <Row label="Plan">
          <Badge label={TIER_LABEL[me.tier] ?? me.tier} cls={TIER_COLOR[me.tier] ?? TIER_COLOR.free} />
        </Row>
        <Row label="Status">
          <Badge
            label={me.status.charAt(0).toUpperCase() + me.status.slice(1)}
            cls={STATUS_COLOR[me.status] ?? STATUS_COLOR.active}
          />
        </Row>
        <Row label="Member since">{joined}</Row>
      </Section>

      <Section title="Licensed device">
        <div className="py-4 flex flex-col gap-3">
          <p className="text-xs text-text-muted leading-relaxed">
            The machine registered to your license. Misty checks this name when activating on a new device. You can change it at any time.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="e.g. MacBook Pro"
              className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
            />
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <SaveFeedback ok={ok} error={error} />
        </div>
      </Section>

      <Section title="App">
        <Row label="Version">
          <span className="font-mono text-xs text-text-muted">v0.1.0-beta</span>
        </Row>
        <Row label="Release channel">Stable</Row>
        <GhostRow label="Check for updates" value="Coming soon" />
        <GhostRow label="Auto-update" value="Coming soon" />
      </Section>

      <Section title="Storage">
        <GhostRow label="Connected providers" value="Coming soon" />
        <GhostRow label="Total indexed files" value="Coming soon" />
        <GhostRow label="Vault backups" value="Coming soon" />
      </Section>

    </div>
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────────

function ProfilePanel({ me, onUpdated }: { me: MeResponse; onUpdated: (name: string) => void }) {
  const [name, setName] = useState(me.name);
  const { saving, error, ok, save } = useSave(async () => {
    await updateProfile(name);
    onUpdated(name);
  });

  const initials = me.name
    ? me.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : me.email[0].toUpperCase();

  return (
    <div className="flex flex-col gap-6">

      <Section title="Profile">
        <div className="py-5 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-elevated border border-border flex items-center justify-center text-lg font-bold text-text shrink-0 select-none">
              {initials}
            </div>
            <div>
              <p className="text-sm font-medium text-text">{me.name}</p>
              <p className="text-xs text-text-muted mt-0.5">{me.email}</p>
              <p className="text-xs text-text-muted/50 mt-1">Photo upload — coming soon</p>
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
            />
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

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={saving || name.trim() === "" || name === me.name}
              className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-bg text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <SaveFeedback ok={ok} error={error} />
          </div>
        </div>
      </Section>

      <Section title="Preferences">
        <Row label="Language">English</Row>
        <Row label="Theme">System</Row>
        <GhostRow label="Notification emails" value="Coming soon" />
        <GhostRow label="Marketing emails" value="Coming soon" />
      </Section>

      <Section title="Connected accounts">
        <div className="py-3 flex items-center justify-between opacity-40">
          <div>
            <p className="text-sm text-text">GitHub</p>
            <p className="text-xs text-text-muted mt-0.5">Sign in with GitHub</p>
          </div>
          <span className="text-xs text-text-muted italic">Coming soon</span>
        </div>
        <div className="py-3 flex items-center justify-between opacity-40">
          <div>
            <p className="text-sm text-text">Google</p>
            <p className="text-xs text-text-muted mt-0.5">Sign in with Google</p>
          </div>
          <span className="text-xs text-text-muted italic">Coming soon</span>
        </div>
      </Section>

    </div>
  );
}

// ─── Account ─────────────────────────────────────────────────────────────────

function AccountPanel({ me }: { me: MeResponse }) {
  const joined = new Date(me.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

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
        <Row label="Type">
          {me.tier === "free" ? "Free forever" : "Perpetual"}
        </Row>
        {me.expires_at ? (
          <Row label="Expires">
            {new Date(me.expires_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </Row>
        ) : me.tier !== "free" ? (
          <Row label="Expires">Never</Row>
        ) : null}
      </Section>

      <Section title="License seats">
        <div className="py-4 flex flex-col gap-2">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-surface/50">
            <div>
              <p className="text-sm text-text font-medium">
                {me.license_device || "Primary device"}
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                {TIER_LABEL[me.tier] ?? me.tier} · Activated
              </p>
            </div>
            <Badge label="Active" cls={STATUS_COLOR.active} />
          </div>

          {me.tier === "max" && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border opacity-50">
              <div className="w-2 h-2 rounded-full border border-border" />
              <p className="text-xs text-text-muted">Additional seats appear here as you activate new devices.</p>
            </div>
          )}

          {me.tier === "free" && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-dashed border-border">
              <p className="text-xs text-text-muted">
                Pro — $30 per device &nbsp;·&nbsp; Max — $89 unlimited devices
              </p>
              <a href="/pricing" className="shrink-0 text-xs text-text hover:text-white underline underline-offset-2 transition-colors">
                Upgrade
              </a>
            </div>
          )}
        </div>
      </Section>

      <Section title="Billing">
        <GhostRow label="Payment method" value="Not connected" />
        <GhostRow label="Last payment" value="—" />
        <GhostRow label="Next invoice" value="—" />
        <div className="py-3 opacity-40">
          <button className="text-sm text-text-muted cursor-not-allowed">Manage billing →</button>
        </div>
      </Section>

      <Section title="Account info">
        <Row label="Name">{me.name}</Row>
        <Row label="Email">{me.email}</Row>
        <Row label="Member since">{joined}</Row>
        <Row label="User ID">
          <span className="font-mono text-xs text-text-muted">{me.id}</span>
        </Row>
      </Section>

      <Section title="Security">
        <div className="py-3 flex items-center justify-between">
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

    </div>
  );
}

// ─── Policy ──────────────────────────────────────────────────────────────────

function PolicyPanel({ onLogout }: { onLogout: () => void }) {
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
        <div className="py-3 flex items-center justify-between opacity-40">
          <div>
            <p className="text-sm text-text">Export your data</p>
            <p className="text-xs text-text-muted mt-0.5">Download a copy of your account data.</p>
          </div>
          <button className="text-sm text-text-muted cursor-not-allowed">Export</button>
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="py-3 flex items-center justify-between">
          <div>
            <p className="text-sm text-text">Sign out</p>
            <p className="text-xs text-text-muted mt-0.5">End your session on this device.</p>
          </div>
          <button onClick={onLogout} className="text-sm text-text-muted hover:text-red-400 transition-colors">
            Sign out
          </button>
        </div>
        <div className="py-3 flex items-center justify-between opacity-40">
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

// ─── Dashboard shell ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();

  const [me, setMe]           = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<Tab>("general");

  useEffect(() => {
    if (!user) { navigate("/signin", { replace: true }); return; }
    fetchMe()
      .then(setMe)
      .catch((err) => { if (err.status === 401) logout(); })
      .finally(() => setLoading(false));
  }, [user, navigate, logout]);

  if (!user || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-border border-t-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen pt-16 flex overflow-hidden">

      {/* ── Sidebar — sticky, never scrolls ─────────────────── */}
      <aside className="hidden md:flex w-48 shrink-0 flex-col border-r border-border px-3 py-8 gap-1 h-full">
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

      {/* ── Scrollable content ──────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-xl px-6 py-8 pb-24 md:pb-12">
          <h1 className="text-xl font-bold text-text tracking-tight mb-6">
            {TABS.find((t) => t.id === tab)?.label}
          </h1>

          {me && tab === "general" && <GeneralPanel me={me} />}

          {me && tab === "profile" && (
            <ProfilePanel
              me={me}
              onUpdated={(name) => {
                setMe((prev) => prev ? { ...prev, name } : prev);
                setUser({ ...user, name });
              }}
            />
          )}

          {me && tab === "account" && <AccountPanel me={me} />}

          {tab === "policy" && <PolicyPanel onLogout={logout} />}
        </div>
      </main>

    </div>
  );
}
