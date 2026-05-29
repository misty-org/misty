import { useState } from "react";
import { HiOutlineChevronDown } from "react-icons/hi2";
import { changelog } from "./data";

export default function Changelog() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1440px] flex-col overflow-hidden px-5 py-4 sm:px-6 lg:h-screen lg:px-8 xl:px-10">
      <div className="border-b border-white/[0.07] pb-4">
        <h1 className="text-[34px] font-semibold tracking-[-0.03em] text-text">
          Changelog
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-6">
        <div className="mx-auto max-w-5xl space-y-3">
        {changelog.map((entry, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={entry.version}
              className="rounded-xl border border-border overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-elevated/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <span className="text-sm font-mono text-primary bg-primary/10 px-2.5 py-1 rounded">
                    {entry.version}
                  </span>
                  <span className="text-text font-medium text-sm">
                    {entry.summary}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted hidden sm:inline">
                    {entry.date}
                  </span>
                  <HiOutlineChevronDown
                    className={`w-4 h-4 text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="px-6 pb-5 pt-1">
                  <ul className="space-y-2">
                    {entry.changes.map((change, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 text-sm text-text-muted"
                      >
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
