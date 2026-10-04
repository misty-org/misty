// cms.fernway.example: a sign-in page. Its password field is a private
// field, which page restore leaves for the person to fill again.

export function CmsSite() {
  return (
    <div className="grid min-h-[900px] place-items-start justify-center bg-[#f3f3f3] pt-28 text-[#161616]">
      <div className="w-[380px] rounded-xl border border-[#dedede] bg-white p-8 shadow-sm">
        <p className="text-[20px] font-semibold">Fernway CMS</p>
        <p className="mt-1 text-[14px] text-[#666]">Sign in to edit the website.</p>
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#333]">Email</span>
            <span className="block rounded-md border border-[#cfcfcf] px-3 py-2 text-[15px]">alex@fernway.example</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#333]">Password</span>
            <span className="block h-[38px] rounded-md border border-[#cfcfcf]" />
          </label>
          <span className="block rounded-md bg-[#151515] py-2.5 text-center text-[14px] font-medium text-white">Sign in</span>
        </div>
      </div>
    </div>
  );
}
