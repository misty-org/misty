// webguide.example and imagenotes.example: reference pages opened while
// researching the launch.

function Masthead({ name, links }: { name: string; links: string[] }) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[#e6e6e6] px-12">
      <span className="text-[17px] font-bold tracking-tight">{name}</span>
      <nav className="flex gap-7 text-[14px] text-[#555]">
        {links.map((link) => (
          <span key={link}>{link}</span>
        ))}
      </nav>
    </header>
  );
}

const sections = [
  { title: "1. Content", items: ["Every page has a final, reviewed draft", "Titles and descriptions are set for each page"] },
  { title: "2. Images", items: ["Export each image at 1x and 2x", "Add alternative text to every image"] },
  { title: "3. Forms", items: ["Submit each form on desktop and mobile", "Confirm messages reach the right inbox"] },
  { title: "4. Redirects", items: ["Map every old address to a new page", "Check for broken links after publishing"] },
];

export function ChecklistSite() {
  return (
    <div className="min-h-[1500px] bg-white text-[#161616]">
      <Masthead name="Webguide" links={["Guides", "Checklists", "Glossary"]} />
      <article className="mx-auto max-w-[760px] px-8 py-14">
        <p className="text-[13px] font-semibold text-[#777]">Checklists · 7 min read</p>
        <h1 className="mt-3 text-[40px] leading-tight font-bold tracking-tight">Pre-launch website checklist</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-[#555]">
          A short list to work through in the week before a new site goes live.
        </p>
        {sections.map((section) => (
          <section key={section.title} className="mt-10">
            <h2 className="text-[22px] font-semibold">{section.title}</h2>
            <ul className="mt-4 space-y-3">
              {section.items.map((item) => (
                <li key={item} className="flex items-center gap-3 text-[16px] text-[#333]">
                  <span className="size-[18px] shrink-0 rounded-[4px] border-2 border-[#9a9a9a]" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </div>
  );
}

const sizes = [
  ["Hero image", "1600 px", "3200 px"],
  ["Product photo", "800 px", "1600 px"],
  ["Thumbnail", "320 px", "640 px"],
  ["Logo", "SVG", "SVG"],
];

export function ImagesSite() {
  return (
    <div className="min-h-[1200px] bg-[#fbfbfb] text-[#161616]">
      <Masthead name="Image Notes" links={["Formats", "Sizes", "Tools"]} />
      <article className="mx-auto max-w-[760px] px-8 py-14">
        <h1 className="text-[40px] leading-tight font-bold tracking-tight">Responsive image sizes</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-[#555]">
          Widths to export for common layouts. Export 2x versions for high-density displays.
        </p>
        <table className="mt-10 w-full border-collapse text-left text-[16px]">
          <thead>
            <tr className="border-b-2 border-[#222] text-[14px] text-[#555]">
              <th className="py-3 font-semibold">Use</th>
              <th className="py-3 font-semibold">1x width</th>
              <th className="py-3 font-semibold">2x width</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map(([use, one, two]) => (
              <tr key={use} className="border-b border-[#e3e3e3]">
                <td className="py-3.5">{use}</td>
                <td className="py-3.5 tabular-nums">{one}</td>
                <td className="py-3.5 tabular-nums">{two}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
