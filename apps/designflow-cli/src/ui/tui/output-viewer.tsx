import React from "react";
import { Box, Text } from "ink";
import type { ArtifactViewerDocument } from "./artifact-viewer";
import type { OutputView } from "./model";
import { designFlowTheme } from "./theme";

export function OutputViewer({
  output,
  document,
  scrollOffset,
  visibleLines,
  details,
}: {
  readonly output: OutputView | undefined;
  readonly document: ArtifactViewerDocument | undefined;
  readonly scrollOffset: number;
  readonly visibleLines: number;
  readonly details: boolean;
}): React.JSX.Element {
  if (output === undefined || document === undefined) {
    return <Text color={designFlowTheme.muted}>Loading output…</Text>;
  }

  const lines = document.lines.slice(scrollOffset, scrollOffset + Math.max(1, visibleLines));
  return (
    <Box flexDirection="column" width="100%" height="100%" overflow="hidden">
      <Text bold color={designFlowTheme.accentStrong}>{document.title}</Text>
      {document.subtitle !== undefined && <Text color={designFlowTheme.muted}>{document.subtitle}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={`${scrollOffset + index}:${line.text}`} color={line.tone === "success" ? designFlowTheme.success : line.tone === "warning" ? designFlowTheme.warning : line.tone === "danger" ? designFlowTheme.danger : line.tone === "primary" ? designFlowTheme.accentStrong : line.tone === "muted" ? designFlowTheme.muted : line.tone === "secondary" ? designFlowTheme.textSecondary : designFlowTheme.textPrimary}>
            {line.text.length === 0 ? " " : line.text}
          </Text>
        ))}
      </Box>
      {details && <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={designFlowTheme.border} paddingX={1}>
        <Text bold color={designFlowTheme.textSecondary}>Technical metadata</Text>
        {document.metadata.map((item) => <Text key={item.label} color={designFlowTheme.muted}>{item.label}: {item.value}</Text>)}
      </Box>}
      {document.lines.length > visibleLines && <Text color={designFlowTheme.muted}>Lines {scrollOffset + 1}–{Math.min(document.lines.length, scrollOffset + visibleLines)} of {document.lines.length}</Text>}
    </Box>
  );
}
