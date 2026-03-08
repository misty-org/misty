
import { NavLink } from "react-router";

export default function MainHero() {
  return (
      <>
        <div className="radial-glow absolute inset-0 pointer-events-none" />
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div className="pt-12 pb-16 md:mt-20 text-center relative">
          <h1 className="text-5xl md:text-7xl lg:text-6xl font-bold text-neutral-300 tracking-tight mb-6 text-balance flex flex-col gap-2">
            <span>The <span className="gradient-text">everything</span> file manager</span>
          </h1>

          <p className="text-lg text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
            Access files across multiple cloud providers in a single window. 
          </p>

          <div className="flex gap-5 justify-center flex-wrap">
            <NavLink to="/register">
              <span className="inline-flex items-center justify-center px-8 py-3.5 bg-zinc-100 text-black font-bold rounded-full transition-all duration-300 shadow-lg hover:bg-gray-200 hover:shadow-zinc-100/20 hover:-translate-y-0.5">
                Get Started
              </span>
            </NavLink>
            <NavLink to="/waitlist">
              <span className="inline-flex items-center justify-center px-8 py-3.5 bg-[#3b82f6] text-black font-bold rounded-full transition-all duration-300 shadow-lg hover:bg-gray-200 hover:shadow-zinc-100/20 hover:-translate-y-0.5">
                Join Waitlist
              </span>
            </NavLink>
          </div>
        </div>
      </>
  )
}
