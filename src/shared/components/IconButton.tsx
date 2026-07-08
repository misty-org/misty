import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

const iconButtonBaseClass =
  "grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] text-[var(--misty-text)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] disabled:opacity-55";

export function IconButton({ children, className, ...buttonProps }: IconButtonProps) {
  return (
    <button className={`${iconButtonBaseClass}${className ? ` ${className}` : ""}`} {...buttonProps}>
      {children}
    </button>
  );
}
