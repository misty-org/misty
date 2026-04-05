import { FaDiscord, FaGithub } from "react-icons/fa";
import { MdOutlineEmail } from "react-icons/md"

export default function MoreSocials() {
  return (
    <div className="text-center flex flex-col justify-evenly items-center gap-10">
      <h2 className="text-2xl md:text-4xl font-bold text-text tracking-tight flex flex-col gap-2">
        <span>It's time for <span className="text-white">simple</span> file management.</span>
        <span>Try Misty now.</span>
      </h2>

      <a
        href="/docs/getting-started"
        className="px-5 py-2 rounded-full bg-white text-black font-semibold text-sm hover:bg-zinc-200 transition-colors shadow-lg"
      >
        Download Now
      </a>
      <div className="flex items-center gap-4 px-5 py-2.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm">
        <span className="text-sm text-text-muted">Join our community</span>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-3">
          <a href="https://discord.gg/your-invite" target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-zinc-200 transition-colors" aria-label="Discord">
            <FaDiscord className="text-3xl" />
          </a>
          <a href="https://github.com/your-repo/misty-web/discussions" target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-zinc-200 transition-colors" aria-label="GitHub Discussions">
            <FaGithub className="text-2xl" />
          </a>
          <a href="mailto:hello@misty.app" className="text-text-muted hover:text-zinc-200 transition-colors" aria-label="Email">
            <MdOutlineEmail className="text-3xl" />
          </a>
        </div>
      </div>
    </div>
  );
}