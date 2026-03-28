import { NavLink } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 sm:px-5 py-10 sm:py-14">
      <div className="relative mx-auto flex max-w-md flex-col items-center pt-6 text-center sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-muted sm:text-base">
          The page you requested does not exist or is no longer available.
        </p>

        <div className="mt-8 w-full rounded-[2rem] border border-white/8 bg-[#090b0d]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
          <NavLink
            to="/"
            className="inline-flex rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-black transition hover:bg-white"
          >
            Go home
          </NavLink>
        </div>
      </div>
    </div>
  );
}
