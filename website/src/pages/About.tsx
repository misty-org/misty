import { AnimateIn } from "../components/AnimateIn";
import { GlowCard } from "../components/GlowCard";

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

export default function About() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Hero */}
      <AnimateIn animation="fade-in-up">
        <div className="max-w-3xl mb-20">
          <span className="text-xs font-medium text-primary uppercase tracking-wider">About</span>
          <h1 className="text-4xl md:text-5xl font-bold text-text mt-3 mb-8 text-balance">
            Built for
            <br />
            <span className="gradient-text">everyone</span>
          </h1>
          <div className="flex flex-col gap-5 text-text-muted leading-relaxed">
            <p>
              We all use multiple cloud services. Google Drive for some things,
              OneDrive for others, maybe Dropbox too. Plus files scattered across
              laptops, desktops, and external drives. It's a mess.
            </p>
            <p>
              Misty brings everything together into one simple app. Connect your
              cloud accounts, link your devices, and browse all your files in a
              single, unified view. No more switching between tabs and apps to
              find what you need.
            </p>
            <p>
              The project is open source and free to use. We believe file
              management should be simple, private, and accessible to everyone.
            </p>
          </div>
        </div>
      </AnimateIn>

      {/* Values */}
      <AnimateIn animation="fade-in">
        <div className="mb-20">
          <h2 className="text-2xl font-bold text-text mb-8">Core Principles</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {values.map((item, i) => (
              <AnimateIn key={item.title} delay={i * 100} animation="fade-in-up">
                <GlowCard className="h-full">
                  <div className="p-7">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                      {item.icon}
                    </div>
                    <h3 className="text-base font-semibold text-text mb-2">{item.title}</h3>
                    <p className="text-sm text-text-muted leading-relaxed">{item.description}</p>
                  </div>
                </GlowCard>
              </AnimateIn>
            ))}
          </div>
        </div>
      </AnimateIn>

      {/* GitHub CTA */}
      <AnimateIn delay={200} animation="fade-in-up">
        <div className="text-center">
          <div className="glass-card rounded-2xl p-10 max-w-xl mx-auto">
            <h3 className="text-xl font-bold text-text mb-3">Open Source</h3>
            <p className="text-text-muted text-sm mb-6 leading-relaxed">
              Misty is completely open source. Check out the code, report issues,
              or contribute on GitHub.
            </p>
            <a
              href="https://github.com/kannachi323/misty"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-text font-medium rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </AnimateIn>
    </div>
  );
}
