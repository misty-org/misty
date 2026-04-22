import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { NavLink } from "react-router";

const adjectives = ["Intelligent", "Powerful", "Unified", "Modern", "Adaptive"];

export default function MainHero() {
  const [adjectiveIndex, setAdjectiveIndex] = useState(0);

  const rotateAdjective = useEffectEvent(() => {
    startTransition(() => {
      setAdjectiveIndex((current) => (current + 1) % adjectives.length);
    });
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      return;
    }

    const interval = window.setInterval(() => {
      rotateAdjective();
    }, 1800);

    return () => window.clearInterval(interval);
  }, [rotateAdjective]);

  return (
    <div className="text-center">
      <h1 className="mb-5 flex flex-col items-center gap-1 text-2xl font-bold tracking-tight text-white md:text-5xl">
        <span className="text-xl text-gray-400 font-medium">
          The
        </span>
        <span
          key={adjectives[adjectiveIndex]}
          className="animate-fade-up"
        >
          {adjectives[adjectiveIndex]}
        </span>
    
        <span>File Manager</span>
      </h1>

      <p className="mx-auto mb-5 max-w-2xl text-base leading-relaxed text-pretty text-text-muted">
        Manage local files, cloud storage, and backups in one interface. Build powerful workflows with fully customizable plugins.
      </p>

      <div className="flex flex-wrap justify-center gap-5">
        <NavLink to="/register">
          <span className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2 font-bold text-black shadow-lg transition-colors duration-300 hover:bg-zinc-200">
            Get Started
          </span>
        </NavLink>
        <NavLink to="/waitlist">
          <span className="inline-flex items-center justify-center rounded-full bg-zinc-700 px-5 py-2 font-bold text-zinc-100 shadow-lg transition-colors duration-300 hover:bg-zinc-600">
            Join Waitlist
          </span>
        </NavLink>
      </div>
    </div>
  );
}
