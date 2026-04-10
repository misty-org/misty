
import { NavLink } from "react-router";

export default function MainHero() {
  return (
    <div className="text-center">
      <h1 className="text-2xl md:text-5xl font-bold text-white tracking-tight mb-6 text-balance flex flex-col gap-2">
        <span>A <span className="text-white">file manager</span> for all your <span className="text-white">clouds</span></span>
      </h1>

      <p className="text-base text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed text-pretty">
        Misty helps you managel all your remote and local storage cloud in one single interface
      </p>

      <div className="flex gap-5 justify-center flex-wrap">
        <NavLink to="/register">
          <span className="inline-flex items-center justify-center px-5 py-2 bg-white text-black font-bold rounded-full transition-colors duration-300 shadow-lg hover:bg-zinc-200">
            Get Started
          </span>
        </NavLink>
        <NavLink to="/waitlist">
          <span className="inline-flex items-center justify-center px-5 py-2 bg-zinc-700 text-zinc-100 font-bold rounded-full transition-colors duration-300 shadow-lg hover:bg-zinc-600">
            Join Waitlist
          </span>
        </NavLink>
      </div>
    </div>
  )
}
