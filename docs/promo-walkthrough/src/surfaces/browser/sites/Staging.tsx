// staging.fernway.example: the draft homepage the example team is launching.
// Rendered as ordinary web content inside the browser pane.

const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };

export function Notebooks({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 300" className={className} aria-hidden>
      <rect width="520" height="300" fill="#e9e7e3" />
      <rect x="70" y="58" width="150" height="200" rx="6" fill="#2b2b2b" />
      <rect x="84" y="58" width="6" height="200" fill="#444" />
      <rect x="196" y="78" width="140" height="186" rx="6" fill="#8d8b87" />
      <rect x="208" y="78" width="6" height="186" fill="#77756f" />
      <rect x="318" y="96" width="132" height="170" rx="6" fill="#f7f6f3" stroke="#c9c6c0" />
      <rect x="330" y="96" width="5" height="170" fill="#dcd9d3" />
      <rect x="352" y="132" width="70" height="6" rx="3" fill="#c9c6c0" />
      <rect x="352" y="146" width="50" height="6" rx="3" fill="#dcd9d3" />
      <rect x="0" y="262" width="520" height="38" fill="#dedbd6" />
    </svg>
  );
}

function Field({ label, value, tall, caret }: { label: string; value: string; tall?: boolean; caret?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#333]">{label}</span>
      <span
        data-t={tall ? "contact-message" : undefined}
        className={`block rounded-md border border-[#cfcfcf] bg-white px-3 text-[15px] text-[#111] ${tall ? "h-28 py-2.5" : "py-2"}`}
      >
        {value}
        {caret && <span className="ml-px inline-block h-[18px] w-px translate-y-[3px] bg-[#111]" />}
      </span>
    </label>
  );
}

export function StagingSite({ message = "", caret }: { message?: string; caret?: boolean }) {
  return (
    <div className="min-h-[1700px] bg-[#faf9f7] text-[#151515]">
      <header className="flex h-16 items-center justify-between border-b border-[#e3e1dc] px-12">
        <span className="text-[19px] font-semibold" style={serif}>
          Fernway Paper Co.
        </span>
        <nav className="flex gap-8 text-[14px] text-[#444]">
          <span>Notebooks</span>
          <span>Planners</span>
          <span>Refills</span>
          <span>Contact</span>
        </nav>
      </header>
      <section className="mx-auto grid max-w-[1040px] grid-cols-[1fr_1.1fr] items-center gap-12 px-12 py-16">
        <div>
          <p className="mb-4 text-[12px] font-semibold tracking-[0.14em] text-[#777] uppercase">Staging preview</p>
          <h1 className="text-[44px] leading-[1.08]" style={serif}>
            Notebooks, planners, and refills.
          </h1>
          <p className="mt-5 max-w-[380px] text-[16px] leading-relaxed text-[#555]">
            Made in Portland. Three sizes, two paper weights, and refills for every cover.
          </p>
          <div className="mt-8 flex gap-3">
            <span className="rounded-md bg-[#151515] px-5 py-2.5 text-[14px] font-medium text-white">
              Browse notebooks
            </span>
            <span className="rounded-md border border-[#cfcfcf] px-5 py-2.5 text-[14px] font-medium">
              Sample pack
            </span>
          </div>
        </div>
        <Notebooks className="w-full rounded-lg" />
      </section>
      <section className="border-t border-[#e3e1dc] bg-white py-14" data-t="staging-products">
        <div className="mx-auto max-w-[1040px] px-12">
          <h2 className="text-[30px]" style={serif}>
            Product overview
          </h2>
          <div className="mt-8 grid grid-cols-3 gap-6">
            {["Pocket", "Field", "Desk"].map((name, index) => (
              <div key={name} className="rounded-lg border border-[#e3e1dc] p-5">
                <div className="h-28 rounded-md" style={{ background: ["#2b2b2b", "#8d8b87", "#dcd9d3"][index] }} />
                <p className="mt-4 text-[16px] font-semibold">{name} notebook</p>
                <p className="mt-1 text-[14px] text-[#666]">{["A6 · 96 pages", "A5 · 128 pages", "A4 · 160 pages"][index]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="border-t border-[#e3e1dc] py-14" data-t="staging-contact">
        <div className="mx-auto grid max-w-[1040px] grid-cols-[1fr_1.4fr] gap-12 px-12">
          <div>
            <h2 className="text-[30px]" style={serif}>
              Contact
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#555]">
              Questions about an order or a wholesale account? Send a note and the studio will reply within two days.
            </p>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name" value="Alex Rivera" />
              <Field label="Email" value="alex@fernway.example" />
            </div>
            <Field label="Message" value={message} tall caret={caret} />
            <span className="inline-block rounded-md bg-[#151515] px-5 py-2.5 text-[14px] font-medium text-white">
              Send message
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
