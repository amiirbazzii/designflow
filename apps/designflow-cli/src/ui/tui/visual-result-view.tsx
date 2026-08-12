import React from "react";
import { Box, Text } from "ink";
import type { VisualResultView } from "../../services/visual-result";
import { designFlowTheme } from "./theme";

export function VisualResultPanel({
  result,
  compact = false,
  selectedAction = 0,
}: {
  readonly result: VisualResultView | undefined;
  readonly compact?: boolean;
  readonly selectedAction?: number;
}): React.JSX.Element {
  if (result === undefined) {
    return <Text color={designFlowTheme.muted}>Loading persisted visual result…</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>{result.title}</Text>
      <Text color={designFlowTheme.textPrimary}>{result.summary}</Text>

      {result.reachability !== undefined && (
        <Box flexDirection="column" marginTop={compact ? 1 : 2}>
          <Text bold color={designFlowTheme.textSecondary}>Reachability</Text>
          <Text color={result.reachability === "rendered" ? designFlowTheme.success : designFlowTheme.warning}>
            {result.reachability === "rendered" ? "✓ Rendered in application" : "! Changed files are not reachable from the rendered application"}
          </Text>
        </Box>
      )}

      {result.findings.length > 0 && (
        <Box flexDirection="column" marginTop={compact ? 1 : 2}>
          <Text bold color={designFlowTheme.textSecondary}>Findings</Text>
          {result.findings.map((finding) => <Text key={finding}>• {finding}</Text>)}
        </Box>
      )}

      {!result.canImprove && result.improveUnavailableReason !== undefined && (
        <Text color={designFlowTheme.muted}>{result.improveUnavailableReason}</Text>
      )}

      {result.actions.length > 0 && (
        <Box flexDirection="column" marginTop={compact ? 1 : 2}>
          <Text bold color={designFlowTheme.textSecondary}>Actions</Text>
          {result.actions.map((action, index) => (
            <Text key={action} color={index === selectedAction ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>
              {index === selectedAction ? "›" : " "} {action}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
