import { NavLink } from "react-router";
import { AnimateIn } from "../components/AnimateIn";
import { GlowCard } from "../components/GlowCard";
import { ParticleField } from "../components/ParticleField";

const features = [
  {
    title: "Unified Cloud Storage",
    description:
      "Browse Google Drive, OneDrive, and Dropbox side by side. No more switching between apps to find your files.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
      </svg>
    ),
  },
  {
    title: "Device-to-Device",
    description:
      "Access files on your other computers without uploading to the cloud. Your devices connect directly and securely.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: "Large File Uploads",
    description:
      "Upload big files without worrying about timeouts or failures. Chunked transfer support handles the heavy lifting.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    title: "Cross-Platform",
    description:
      "Available on Windows, macOS, and Linux. One app that works the same way on every platform you use.",
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

const steps = [
  {
    number: "1",
    title: "Connect your accounts",
    description: "Link your Google Drive, OneDrive, and Dropbox in a few clicks.",
  },
  {
    number: "2",
    title: "Browse everything",
    description: "See all your cloud files and device storage in one unified view.",
  },
  {
    number: "3",
    title: "Manage from one place",
    description: "Move, copy, and organize files across all your storage from a single app.",
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

        <div className="max-w-6xl mx-auto px-6 pt-20 pb-28 md:pt-32 md:pb-40 text-center relative">
          <AnimateIn delay={0} animation="fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-surface/50 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-glow-pulse" />
              <span className="text-xs font-medium text-text-muted">
                All your cloud files in one place
              </span>
            </div>
          </AnimateIn>

          <AnimateIn delay={100} animation="fade-in-up">
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-text tracking-tight mb-6 text-balance">
              All your files,
              <br />
              <span className="gradient-text">one app.</span>
            </h1>
          </AnimateIn>

          <AnimateIn delay={200} animation="fade-in-up">
            <p className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
              Misty brings together Google Drive, OneDrive, Dropbox, and your
              devices into a single, simple file manager. Free and open source.
            </p>
          </AnimateIn>

          <AnimateIn delay={300} animation="fade-in-up">
            <div className="flex gap-4 justify-center flex-wrap">
              <NavLink
                to="/download"
                className="group relative px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                <span className="relative z-10">Download Free</span>
              </NavLink>
              <NavLink
                to="/pricing"
                className="px-8 py-3.5 bg-transparent hover:bg-elevated text-text font-medium rounded-xl border border-border hover:border-text-muted/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                See Pricing
              </NavLink>
            </div>
          </AnimateIn>

          {/* Cloud provider visual */}
          <AnimateIn delay={500} animation="scale-in">
            <div className="mt-20 max-w-2xl mx-auto">
              <div className="glass-card rounded-2xl overflow-hidden p-10">
                <div className="flex items-center justify-center gap-6 md:gap-10 flex-wrap">
                  {/* Google Drive */}
                  <div className="flex flex-col items-center gap-2 group">
                    <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.71 3.5L1.15 15l3.43 5.98L11.14 9.49 7.71 3.5zm8.56 0H7.71l6.56 11.49h8.57L16.27 3.5zM1.15 15l3.43 5.98h13.71l3.43-5.98H1.15z" className="text-text-secondary" />
                      </svg>
                    </div>
                    <span className="text-xs text-text-muted">Google Drive</span>
                  </div>

                  {/* OneDrive */}
                  <div className="flex flex-col items-center gap-2 group">
                    <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                      <svg className="w-7 h-7 text-text-secondary" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10.5 18.5h8.25a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 14.25 4.5 4.5 0 006.75 18.5H10.5z" />
                      </svg>
                    </div>
                    <span className="text-xs text-text-muted">OneDrive</span>
                  </div>

                  {/* Misty (center) */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 border-2 border-primary/40 flex items-center justify-center shadow-lg shadow-primary/20">
                      <img src="/misty.png" alt="Misty" className="w-9 h-9" />
                    </div>
                    <span className="text-xs font-medium text-primary">Misty</span>
                  </div>

                  {/* Dropbox */}
                  <div className="flex flex-col items-center gap-2 group">
                    <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                      <svg className="w-7 h-7 text-text-secondary" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 2l6 3.75L6 9.5 0 5.75 6 2zm12 0l6 3.75-6 3.75-6-3.75L18 2zM0 13.25L6 9.5l6 3.75-6 3.75-6-3.75zm18-3.75l6 3.75-6 3.75-6-3.75 6-3.75zM6 18.25l6-3.75 6 3.75-6 3.75-6-3.75z" />
                      </svg>
                    </div>
                    <span className="text-xs text-text-muted">Dropbox</span>
                  </div>

                  {/* Your Devices */}
                  <div className="flex flex-col items-center gap-2 group">
                    <div className="w-14 h-14 rounded-2xl bg-surface flex items-center justify-center border border-border/50 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/10">
                      <svg className="w-7 h-7 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                      </svg>
                    </div>
                    <span className="text-xs text-text-muted">Your Devices</span>
                  </div>
                </div>
              </div>
            </div>
          </AnimateIn>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border/50 bg-surface/30">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <AnimateIn key={stat.label} delay={i * 100} animation="fade-in">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-bold text-text mb-1">
                    {stat.value}
                  </div>
                  <div className="text-sm text-text-muted">{stat.label}</div>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <AnimateIn animation="fade-in">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 text-balance">
              Everything in one place
            </h2>
            <p className="text-text-muted max-w-xl mx-auto text-pretty">
              Stop juggling between apps and browser tabs. Misty gives you one
              view for all your files, everywhere.
            </p>
          </div>
        </AnimateIn>

        <div className="grid md:grid-cols-2 gap-5">
          {features.map((feature, i) => (
            <AnimateIn key={feature.title} delay={i * 100} animation="fade-in-up">
              <GlowCard className="h-full">
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
            </AnimateIn>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <AnimateIn animation="fade-in">
            <div className="text-center mb-16">
              <span className="text-xs font-medium text-primary uppercase tracking-wider">How It Works</span>
              <h2 className="text-3xl md:text-4xl font-bold text-text mt-3 mb-4 text-balance">
                Up and running in minutes
              </h2>
              <p className="text-text-muted max-w-lg mx-auto text-pretty">
                Three simple steps to bring all your files together.
              </p>
            </div>
          </AnimateIn>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((step, i) => (
              <AnimateIn key={step.number} delay={i * 150} animation="fade-in-up">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary text-xl font-bold flex items-center justify-center mx-auto mb-5">
                    {step.number}
                  </div>
                  <h3 className="text-lg font-semibold text-text mb-2">{step.title}</h3>
                  <p className="text-sm text-text-muted leading-relaxed">{step.description}</p>
                </div>
              </AnimateIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 radial-glow pointer-events-none" />
        <div className="max-w-6xl mx-auto px-6 py-24 text-center relative">
          <AnimateIn animation="fade-in-up">
            <h2 className="text-3xl md:text-5xl font-bold text-text mb-5 text-balance">
              Ready to simplify your files?
            </h2>
            <p className="text-text-muted mb-10 max-w-lg mx-auto text-pretty">
              Misty is free, open source, and available on all major platforms.
              Try it today.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <NavLink
                to="/download"
                className="px-8 py-3.5 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                Download Free
              </NavLink>
              <NavLink
                to="/pricing"
                className="px-8 py-3.5 bg-transparent hover:bg-elevated text-text font-medium rounded-xl border border-border hover:border-text-muted/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                View Pricing
              </NavLink>
            </div>
          </AnimateIn>
        </div>
      </section>
    </div>
  );
}
