export const designFlowTheme = {
  accent: "blue",
  accentStrong: "blueBright",
  textPrimary: "white",
  textSecondary: "gray",
  muted: "gray",
  border: "gray",
  success: "green",
  warning: "yellow",
  danger: "red",
  focus: "blue",
} as const;

export type DesignFlowTheme = typeof designFlowTheme;

export function statusColor(
  status: "ready" | "active" | "pending" | "complete" | "unavailable" | "not-configured" | "not-detected" | "idle" | "needs-attention" | "failed" | "skipped",
): string {
  if (status === "ready" || status === "complete") return designFlowTheme.success;
  if (status === "active") return designFlowTheme.accentStrong;
  if (status === "failed" || status === "not-configured") return designFlowTheme.danger;
  if (status === "needs-attention" || status === "unavailable" || status === "not-detected") return designFlowTheme.warning;
  return designFlowTheme.muted;
}
