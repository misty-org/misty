
import { NavLink } from "react-router";

export default function MainHero() {
  return (
      <>
        <div className="radial-glow absolute inset-0 pointer-events-none" />
        <div className="absolute inset-0 grid-bg pointer-events-none" />

        <div className="max-w-6xl mx-auto px-6 pt-12 pb-16 md:mt-20 text-center relative">
          <h1 className="text-5xl md:text-7xl lg:text-6xl font-bold text-text tracking-tight mb-6 text-balance">
            <span>The <span className="gradient-text">bridge</span> between clouds</span>
          </h1>

          <p className="text-lg md:text-sm text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
            A fast, lightweight file manager for your cloud and local files. Browse, copy, and move files across multiple providers in a single window.
          </p>

          <div className="flex gap-4 justify-center flex-wrap">
            <NavLink to="/register">
              <span className="inline-flex items-center justify-center px-8 py-3.5 bg-white text-black font-bold rounded-full transition-all duration-300 shadow-lg hover:bg-gray-200 hover:shadow-white/20 hover:-translate-y-0.5">
                Get Started
              </span>
            </NavLink>
          </div>
        </div>
      </>
  )
}