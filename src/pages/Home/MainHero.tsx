import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";

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
  }, []);

  return (
    <div className="text-center">
      <h1 className="mb-5 flex flex-col items-center gap-1 text-2xl font-bold tracking-tight text-foreground md:text-5xl">
        <span className="text-xl font-medium text-muted-foreground">
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

      <p className="mx-auto mb-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground">
        Misty brings local files, cloud storage, search, and transfers into one focused desktop workspace for people who need their files to move with them.
      </p>

      <div className="flex flex-wrap justify-center gap-5">
        <Button asChild size="lg" className="rounded-full px-5 font-semibold shadow-sm">
          <NavLink to="/download">
            Download Misty
          </NavLink>
        </Button>
        <Button asChild size="lg" variant="secondary" className="rounded-full px-5 font-semibold shadow-sm">
          <a href="https://discord.gg/M3EQuWcFS" target="_blank" rel="noopener noreferrer">
            Join Discord
          </a>
        </Button>
      </div>
    </div>
  );
}
