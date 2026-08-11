import React from "react";
import { Box, Text } from "ink";
import type { ProposalReview } from "../../services/proposal-review";
import type { TuiReviewRequest } from "./navigation";
import { designFlowTheme } from "./theme";

export function ProposalReviewView({
  request,
  selectedAction,
}: {
  readonly request: TuiReviewRequest;
  readonly selectedAction: number;
}): React.JSX.Element {
  const { review } = request;
  const actions = ["View diff", "Apply", "Reject"];
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Ready to apply</Text>
      <Text color={designFlowTheme.textSecondary}>{review.totals.fileCount} files  <Text color={designFlowTheme.success}>+{review.totals.additions}</Text>  <Text color={designFlowTheme.danger}>-{review.totals.deletions}</Text></Text>
      <Box flexDirection="column" marginTop={1}>
        {groupFiles(review, "create").length > 0 && <FileGroup label="Create" files={groupFiles(review, "create")} />}
        {groupFiles(review, "modify").length > 0 && <FileGroup label="Modify" files={groupFiles(review, "modify")} />}
        {groupFiles(review, "delete").length > 0 && <FileGroup label="Delete" files={groupFiles(review, "delete")} />}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={designFlowTheme.textSecondary}>Checks</Text>
        {request.checks.map((check) => <Text key={check.label} color={designFlowTheme.success}>✓ {check.label}</Text>)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, index) => <Text key={action} color={index === selectedAction ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>{index === selectedAction ? "›" : " "} {action}</Text>)}
      </Box>
      <Text color={designFlowTheme.textSecondary}>No project files have been changed yet.</Text>
    </Box>
  );
}

export function DiffView({
  review,
  fileIndex,
  scrollOffset,
  visibleLines,
}: {
  readonly review: ProposalReview;
  readonly fileIndex: number;
  readonly scrollOffset: number;
  readonly visibleLines: number;
}): React.JSX.Element {
  const file = review.files[fileIndex];
  if (file === undefined) return <Text color={designFlowTheme.warning}>No diff is available.</Text>;
  const lines = file.diff.slice(scrollOffset, scrollOffset + Math.max(1, visibleLines));
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Diff · {file.path}</Text>
      <Text color={designFlowTheme.textSecondary}>{fileIndex + 1} of {review.files.length}  {file.action}  <Text color={designFlowTheme.success}>+{file.additions}</Text> <Text color={designFlowTheme.danger}>-{file.deletions}</Text></Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => <DiffLine key={`${scrollOffset + index}:${line}`} line={line} />)}
      </Box>
      {file.diff.length > visibleLines && <Text color={designFlowTheme.muted}>Showing {scrollOffset + 1}–{Math.min(file.diff.length, scrollOffset + visibleLines)} of {file.diff.length}</Text>}
    </Box>
  );
}

function DiffLine({ line }: { readonly line: string }): React.JSX.Element {
  const color = line.startsWith("+") && !line.startsWith("+++")
    ? designFlowTheme.success
    : line.startsWith("-") && !line.startsWith("---")
      ? designFlowTheme.danger
      : line.startsWith("@@") ? designFlowTheme.accent : designFlowTheme.textSecondary;
  return <Text color={color}>{line.slice(0, 240)}</Text>;
}

function groupFiles(review: ProposalReview, action: "create" | "modify" | "delete") {
  return review.files.filter((file) => file.action === action);
}

function FileGroup({ label, files }: { readonly label: string; readonly files: readonly { path: string }[] }): React.JSX.Element {
  return <Box flexDirection="column" marginTop={1}><Text color={designFlowTheme.textSecondary}>{label}</Text>{files.slice(0, 50).map((file) => <Text key={file.path}>  {file.path}</Text>)}{files.length > 50 && <Text color={designFlowTheme.muted}>  … {files.length - 50} more</Text>}</Box>;
}

export function LifecycleResultView({
  title,
  sessionLines,
  actions = [],
}: {
  readonly title: string;
  readonly sessionLines: readonly string[];
  readonly actions?: readonly string[];
}): React.JSX.Element {
  return <Box flexDirection="column"><Text bold color={designFlowTheme.textPrimary}>{title}</Text><Box flexDirection="column" marginTop={2}>{sessionLines.map((line, index) => <Text key={`${index}:${line}`} color={line.startsWith("✕") || line.startsWith("!") ? designFlowTheme.danger : line.startsWith("✓") ? designFlowTheme.success : designFlowTheme.textPrimary}>{line}</Text>)}</Box>{actions.length > 0 && <Box flexDirection="column" marginTop={2}>{actions.map((action) => <Text key={action} color={designFlowTheme.accentStrong}>[ {action} ]</Text>)}</Box>}</Box>;
}
