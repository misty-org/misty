
import { NavLink } from "react-router";

export default function MainHero() {
  return (
      <>
        <div className="radial-glow absolute inset-0 pointer-events-none" />
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div className="pt-12 md:mt-20 text-center relative">
          <h1 className="text-5xl md:text-7xl lg:text-6xl font-bold text-white tracking-tight mb-6 text-balance flex flex-col gap-2">
              <span>A <span className="gradient-text">file manager</span> for all your <span className="gradient-text">clouds</span></span>
          </h1>

          <p className="text-lg text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
            No mounted drives, no browser tabs. Browse, move, and organize all your cloud and
            local files in one single window.
          </p>

          <div className="flex gap-5 justify-center flex-wrap">
            <NavLink to="/register">
              <span className="inline-flex items-center justify-center px-8 py-3.5 bg-white text-black font-bold rounded-full transition-colors duration-300 shadow-lg hover:bg-zinc-200">
                Get Started
              </span>
            </NavLink>
            <NavLink to="/waitlist">
              <span className="inline-flex items-center justify-center px-8 py-3.5 bg-zinc-700 text-zinc-100 font-bold rounded-full transition-colors duration-300 shadow-lg hover:bg-zinc-600">
                Join Waitlist
              </span>
            </NavLink>
          </div>
        </div>
      </>
  )
}
