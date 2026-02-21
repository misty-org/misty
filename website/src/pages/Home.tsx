import { NavLink } from "react-router";
import { GlowCard } from "../components/GlowCard";
import { ParticleField } from "../components/ParticleField";
import { SiGoogledrive, SiIcloud, SiDropbox } from "react-icons/si";  
import { GrOnedrive } from "react-icons/gr";

const features = [
  {
    title: "All Your Clouds, One Window",
    description:
      "Google Drive, OneDrive, Dropbox — browse them all side by side without opening a single browser tab.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
  },
  {
    title: "Reach Your Other Computers",
    description:
      "Need a file from your desktop while you're on your laptop? Just open Misty. Your devices talk to each other directly.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: "Big Files? No Problem",
    description:
      "Upload large files without worrying about timeouts or failures. Misty handles the heavy lifting so you don't have to.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    title: "Works on Everything",
    description:
      "Windows, macOS, or Linux — Misty looks and feels the same everywhere. Pick your platform, we've got you covered.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
  },
];

const stats = [
  { value: "3", label: "Cloud Providers" },
  { value: "\u221E", label: "Devices" },
  { value: "Free", label: "To Use" },
  { value: "3", label: "Platforms" },
];

const values = [
  {
    title: "Open Source",
    description: "Every line of code is publicly available. Transparency is fundamental to trust.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: "Privacy First",
    description: "Your data stays on your devices. Misty never routes files through external servers.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    title: "Simple by Design",
    description: "No complicated setup, no learning curve. Just install and start managing your files.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
];

const steps = [
  {
    number: "1",
    title: "Sign in to your clouds",
    description: "Link your Google Drive, OneDrive, and Dropbox in a few clicks. That's it.",
  },
  {
    number: "2",
    title: "See everything at once",
    description: "All your cloud files and local folders show up together, like they always should have.",
  },
  {
    number: "3",
    title: "Just use it",
    description: "Move, copy, and organize files across all your storage. No more guessing where things are.",
  },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <ParticleField />
        <div className="radial-glow absolute inset-0 pointer-events-none" />
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div className="max-w-6xl mx-auto px-6 pt-12 pb-28 md:pt-20 md:pb-40 text-center relative">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-text tracking-tight mb-6 text-balance">
            All your files,
            <br />
            <span className="gradient-text">all in one place.</span>
          </h1>

          <p className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
            Your files should feel local. Misty connects all your cloud files into one seamless file explorer.
          </p>

          <div className="flex gap-4 justify-center flex-wrap">
            <NavLink
              to="/download"
              className="group relative px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              <span className="relative z-10">Download Free</span>
            </NavLink>
          </div>

          {/* Cloud provider visual */}
          <div className="mt-20 max-w-2xl mx-auto">
            <p className="text-sm text-text-muted text-center mb-4">
              Connect the storage you already use — all managed from a single window.
            </p>
            <div className="glass-card rounded-2xl overflow-hidden p-10">
              <div className="flex items-center justify-center gap-6 md:gap-10 flex-wrap">
                {/* Google Drive */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                    <SiGoogledrive className="w-7 h-7 text-text-secondary" />
                  </div>
                  <span className="text-xs text-text-muted">Google Drive</span>
                </div>

                {/* OneDrive */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                    <GrOnedrive className="w-7 h-7 text-text-secondary" />
                  </div>
                  <span className="text-xs text-text-muted">OneDrive</span>
                </div>

                {/* iCloud */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                    <SiIcloud className="w-7 h-7 text-text-secondary" />
                  </div>
                  <span className="text-xs text-text-muted">iCloud</span>
                </div>

                {/* Dropbox */}
                <div className="flex flex-col items-center gap-2 group">
                  <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                    <SiDropbox className="w-7 h-7 text-text-secondary" />
                  </div>
                  <span className="text-xs text-text-muted">Dropbox</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
              Your files are everywhere
            </h2>
            <p className="text-text-muted max-w-2xl mx-auto text-pretty">
              Some photos on Google Drive. Work docs on OneDrive. That one folder
              you shared on Dropbox. And everything else scattered across two
              laptops and a desktop. You spend more time looking for files than
              actually using them.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            <div className="glass-card rounded-2xl p-8">
              <h3 className="text-lg font-semibold text-danger mb-4">Without Misty</h3>
              <ul className="flex flex-col gap-3 text-sm text-text-muted">
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Juggling multiple tabs and apps just to find one file
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Downloading and re-uploading files to move them between providers
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Managing separate logins and storage limits across services
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  No way to search or organize files across providers
                </li>
              </ul>
            </div>

            <div className="glass-card rounded-2xl p-8 border-primary/20">
              <h3 className="text-lg font-semibold text-primary mb-4">With Misty</h3>
              <ul className="flex flex-col gap-3 text-sm text-text-muted">
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  One unified file explorer for all your cloud accounts
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Drag and drop files between providers seamlessly
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Connect multiple accounts per provider to avoid complex management
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Search across all your cloud storage at once
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
              One file explorer to replace them all
            </h2>
            <p className="text-text-muted max-w-xl mx-auto text-pretty">
              No more juggling tabs, apps, and folders. Open Misty and
              everything you need is already there.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {features.map((feature) => (
              <GlowCard key={feature.title} className="h-full">
                <div className="p-7">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-text mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-text-muted leading-relaxed text-sm">
                    {feature.description}
                  </p>
                </div>
              </GlowCard>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
              Ready in minutes, useful forever
            </h2>
            <p className="text-text-muted max-w-lg mx-auto text-pretty">
              Three steps. That's all it takes to never lose track of a file again.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((step) => (
              <div key={step.number} className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary text-xl font-bold flex items-center justify-center mx-auto mb-5">
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold text-text mb-2">{step.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About / Core Principles */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-6 text-balance">
              Built for <span className="gradient-text">everyone</span>
            </h2>
            <div className="flex flex-col gap-4 text-text-muted leading-relaxed text-pretty">
              <p>
                Your files shouldn't be trapped behind five different apps and
                logins. You shouldn't need to remember which cloud has which
                folder, or email yourself a file just to open it on another computer.
              </p>
              <p>
                We built Misty because we were tired of it too. It's free, it's
                open source, and it's the file manager we always wished existed.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {values.map((item) => (
              <GlowCard key={item.title} className="h-full">
                <div className="p-7">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                    {item.icon}
                  </div>
                  <h3 className="text-base font-semibold text-text mb-2">{item.title}</h3>
                  <p className="text-sm text-text-muted leading-relaxed">{item.description}</p>
                </div>
              </GlowCard>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="max-w-6xl mx-auto px-6 py-24 text-center relative">
          <h2 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
            Your last file manager
          </h2>
          <p className="text-text-muted mb-10 max-w-lg mx-auto text-pretty">
            Free, open source, and available on every major platform.
            Once you try it, you won't go back.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <NavLink
              to="/download"
              className="px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              Download Free
            </NavLink>
            <a
              href="https://github.com/kannachi323/misty"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-transparent hover:bg-elevated text-text font-medium rounded-xl border border-border hover:border-text-muted/30 transition-all duration-300 hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
