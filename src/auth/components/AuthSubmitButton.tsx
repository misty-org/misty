interface AuthSubmitButtonProps {
  idleLabel: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
}

export default function AuthSubmitButton({
  idleLabel,
  loadingLabel,
  loading,
  disabled,
}: AuthSubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className="w-full rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? loadingLabel : idleLabel}
    </button>
  );
}
