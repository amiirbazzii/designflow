export interface ButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}

export function Button({
  children,
  variant = "primary",
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type="button"
      data-variant={variant}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
