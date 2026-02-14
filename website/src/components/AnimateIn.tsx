import { useInView } from "../hooks/useInView";

interface AnimateInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  animation?: "fade-in" | "fade-in-up" | "scale-in";
}

export function AnimateIn({
  children,
  className = "",
  delay = 0,
  animation = "fade-in-up",
}: AnimateInProps) {
  const { ref, inView } = useInView({ threshold: 0.1 });

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView
          ? "translateY(0) scale(1)"
          : animation === "scale-in"
          ? "scale(0.95)"
          : animation === "fade-in-up"
          ? "translateY(40px)"
          : "translateY(20px)",
        transition: `opacity 0.7s ease-out ${delay}ms, transform 0.7s ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
