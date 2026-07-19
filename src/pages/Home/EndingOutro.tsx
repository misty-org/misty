import { FaDiscord, FaGithub } from "react-icons/fa";
import { MdOutlineEmail } from "react-icons/md"
import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function MoreSocials() {
  return (
    <div className="text-center flex flex-col justify-evenly items-center gap-10">
      <h2 className="text-2xl md:text-4xl font-bold text-foreground tracking-tight flex flex-col gap-2">
        <span>Bring every file into one workspace.</span>
        <span>Move faster with Misty.</span>
      </h2>

      <Button asChild className="rounded-full px-5 shadow-sm">
        <NavLink to="/download">Download Misty</NavLink>
      </Button>
      <div className="flex items-center gap-4 rounded-full border border-border bg-card/70 px-5 py-2.5 shadow-xs backdrop-blur-sm">
        <span className="text-sm text-muted-foreground">Join our community</span>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-3">
          <a href="https://discord.gg/M3EQuWcFS" target="_blank" rel="noopener noreferrer" className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Discord">
            <FaDiscord className="text-3xl" />
          </a>
          <a href="https://github.com/misty-org/misty-public" target="_blank" rel="noopener noreferrer" className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Misty public releases">
            <FaGithub className="text-2xl" />
          </a>
          <a href="mailto:hello@misty.app" className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Email">
            <MdOutlineEmail className="text-3xl" />
          </a>
        </div>
      </div>
    </div>
  );
}
