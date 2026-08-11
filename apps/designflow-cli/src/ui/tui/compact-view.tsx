import React from "react";
import { Box, Text } from "ink";
import type { DesignFlowSessionView } from "./model";
import type { TuiNavigationState } from "./navigation";
import { designFlowTheme } from "./theme";
import { ExecutionView } from "./execution-view";
import { OutputViewer } from "./output-viewer";
import { DiffView, LifecycleResultView, ProposalReviewView } from "./review-view";
import type { ArtifactViewerDocument } from "./artifact-viewer";
import { visibleUrlWindow } from "./url-window";

export function CompactView({
  session,
  navigation,
  focusArea,
  selectedOutput,
  destinationVisibleCount,
  viewerDocument,
  viewerVisibleLines,
  selectedOutputView,
  executionPrompt,
}: {
  readonly session: DesignFlowSessionView;
  readonly navigation: TuiNavigationState;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly selectedOutput: number;
  readonly destinationVisibleCount: number;
  readonly viewerDocument?: ArtifactViewerDocument | undefined;
  readonly viewerVisibleLines: number;
  readonly selectedOutputView?: DesignFlowSessionView["outputs"][number] | undefined;
  readonly executionPrompt?: { readonly question: string; readonly options?: readonly string[]; readonly value: string } | undefined;
}): React.JSX.Element {
  return <Box flexGrow={1} flexDirection="column" paddingX={1}>
    <Text color={designFlowTheme.warning}>Compact terminal mode</Text>
    {navigation.view === "output-viewer" ? <OutputViewer output={selectedOutputView} document={viewerDocument} scrollOffset={navigation.outputScrollOffset} visibleLines={viewerVisibleLines} details={navigation.outputDetails} />
      : session.outputs.length > 0 && focusArea === "outputs" ? <CompactOptions title="Outputs" options={session.outputs.map((output) => `${output.status === "available" ? "✓" : "○"} ${output.label}`)} active={selectedOutput} />
      : navigation.view === "design-selection" ? <CompactOptions title="Select design" options={["Current Figma selection", "Paste Figma URL"]} active={navigation.designOption} />
      : navigation.view === "figma-url-entry" ? <Box flexDirection="column"><Text bold>Paste Figma URL</Text><Text>{visibleUrlWindow(navigation.urlValue, navigation.urlCursor, 28).before}▌</Text>{navigation.urlError !== undefined && <Text color={designFlowTheme.danger}>{navigation.urlError}</Text>}</Box>
      : navigation.view === "destination-selection" ? <CompactOptions title="Choose destination" options={navigation.destinationCandidates.slice(navigation.destinationScrollOffset, navigation.destinationScrollOffset + destinationVisibleCount).map((candidate) => candidate.label)} active={Math.max(0, navigation.destinationIndex - navigation.destinationScrollOffset)} />
      : navigation.view === "approval-mode" ? <CompactOptions title="Approval mode" options={["Review changes myself", "Let DesignFlow handle approvals"]} active={navigation.approvalOption} />
      : navigation.view === "ready-to-run" ? <Box flexDirection="column"><Text bold>Ready to start</Text><Text color={designFlowTheme.success}>✓ {session.design.label}</Text><Text color={designFlowTheme.success}>✓ {session.destination.value ?? session.destination.label}</Text><Text color={designFlowTheme.accent}>Approval: {session.approval.mode === "designflow" ? "DesignFlow handles approvals" : "Review changes myself"}</Text><Text color={designFlowTheme.accentStrong}>[ Enter ] Start</Text></Box>
      : navigation.view === "execution" ? <ExecutionView session={session} prompt={executionPrompt} />
      : navigation.view === "proposal-review" || navigation.view === "correction-review" ? navigation.review === undefined ? <Text color={designFlowTheme.warning}>Proposal review is unavailable.</Text> : <ProposalReviewView request={navigation.review} selectedAction={navigation.reviewActionIndex} />
      : navigation.view === "diff-view" ? navigation.review === undefined ? <Text color={designFlowTheme.warning}>Diff is unavailable.</Text> : <DiffView review={navigation.review.review} fileIndex={navigation.reviewFileIndex} scrollOffset={navigation.diffScrollOffset} visibleLines={viewerVisibleLines} />
      : navigation.view === "applying" ? <LifecycleResultView title="Applying" sessionLines={["● Applying changes…"]} />
      : navigation.view === "validation-result" ? <LifecycleResultView title="Validation" sessionLines={session.checks.map((check) => `${check.status === "passed" ? "✓" : check.status === "failed" ? "✕" : "○"} ${check.label}`)} />
      : navigation.view === "visual-result" ? <LifecycleResultView title="Visual result" sessionLines={[session.finalResult?.summary ?? "Visual validation complete.", "Visual validation report is available in Outputs."]} actions={["View report"]} />
      : navigation.view === "final-result" ? <LifecycleResultView title={session.finalResult?.status === "failure" ? "Needs attention" : "Done"} sessionLines={[session.finalResult?.summary ?? "DesignFlow finished.", "Outputs remain available for inspection."]} />
      : <Box flexDirection="column"><Text bold>Ready to start</Text><Text>Press Enter to select a design.</Text></Box>}
  </Box>;
}

function CompactOptions({ title, options, active }: { readonly title: string; readonly options: readonly string[]; readonly active: number }): React.JSX.Element {
  return <Box flexDirection="column"><Text bold>{title}</Text>{options.map((option, index) => <Text key={option} color={index === active ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>{index === active ? "›" : " "} {option}</Text>)}</Box>;
}
