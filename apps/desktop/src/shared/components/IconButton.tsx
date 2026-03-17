import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function IconButton({ children, className, ...buttonProps }: IconButtonProps) {
  return (
    <button className={`icon-button${className ? ` ${className}` : ""}`} {...buttonProps}>
      {children}
    </button>
  );
}
