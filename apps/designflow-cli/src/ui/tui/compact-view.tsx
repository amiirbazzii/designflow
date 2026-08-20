import React from "react";
import { Box, Text } from "ink";
import type { DesignFlowSessionView } from "./model";
import type { TuiNavigationState } from "./navigation";
import { designFlowTheme } from "./theme";
import { ExecutionView } from "./execution-view";
import { OutputViewer } from "./output-viewer";
import { DiffView, LifecycleResultView, ProposalReviewView } from "./review-view";
import { AuthView } from "./auth-view";
import type { ArtifactViewerDocument } from "./artifact-viewer";
import { renderVisibleUrlWindow, urlInputContentWidth, visibleUrlWindow } from "./url-window";
import type { VisualResultView } from "../../services/visual-result";
import { VisualResultPanel } from "./visual-result-view";
import type { TuiPromptState } from "./text-input";
import { terminalOutcomeMenuActions, type TerminalOutcomeView } from "./outcome";

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
  visualResult,
  terminalColumns,
  terminalOutcome,
  freshMode = false,
}: {
  readonly session: DesignFlowSessionView;
  readonly navigation: TuiNavigationState;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly selectedOutput: number;
  readonly destinationVisibleCount: number;
  readonly viewerDocument?: ArtifactViewerDocument | undefined;
  readonly viewerVisibleLines: number;
  readonly selectedOutputView?: DesignFlowSessionView["outputs"][number] | undefined;
  readonly executionPrompt?: TuiPromptState | undefined;
  readonly visualResult?: VisualResultView | undefined;
  readonly terminalColumns: number;
  readonly terminalOutcome?: TerminalOutcomeView | undefined;
  readonly freshMode?: boolean;
}): React.JSX.Element {
  return <Box flexGrow={1} flexDirection="column" paddingX={1}>
    <Text color={designFlowTheme.warning}>Compact terminal mode</Text>
    {navigation.view === "output-viewer" ? <OutputViewer output={selectedOutputView} document={viewerDocument} scrollOffset={navigation.outputScrollOffset} visibleLines={viewerVisibleLines} details={navigation.outputDetails} />
      : session.outputs.length > 0 && focusArea === "outputs" ? <CompactOptions title="Outputs" options={session.outputs.map((output) => `${output.status === "available" ? "✓" : "○"} ${output.label}`)} active={selectedOutput} />
      : navigation.view === "design-selection" ? <CompactOptions title={freshMode ? "Select Figma source" : "Select design"} options={freshMode ? ["Current Figma selection", "Paste Figma frame URL"] : ["Current Figma selection", "Paste Figma URL"]} active={navigation.designOption} />
      : navigation.view === "figma-url-entry" ? <Box flexDirection="column"><Text bold>{freshMode ? "Paste Figma frame URL" : "Paste Figma URL"}</Text><Text wrap="truncate">{renderVisibleUrlWindow(visibleUrlWindow(navigation.urlValue, navigation.urlCursor, urlInputContentWidth(terminalColumns, true)))}</Text>{navigation.urlError !== undefined && <Text color={designFlowTheme.danger}>{navigation.urlError}</Text>}</Box>
      : navigation.view === "destination-selection" ? <CompactOptions title="Choose destination" options={navigation.destinationCandidates.slice(navigation.destinationScrollOffset, navigation.destinationScrollOffset + destinationVisibleCount).map((candidate) => candidate.label)} active={Math.max(0, navigation.destinationIndex - navigation.destinationScrollOffset)} />
      : navigation.view === "approval-mode" ? <CompactOptions title="Approval mode" options={["Review changes myself", "Let DesignFlow handle approvals"]} active={navigation.approvalOption} />
      : navigation.view === "ready-to-generate" && navigation.freshState !== undefined ? <Box flexDirection="column"><Text bold>Ready to generate</Text><Text color={designFlowTheme.success}>✓ {navigation.freshState.design.label}</Text><Text color={designFlowTheme.textSecondary}>Frame node: {navigation.freshState.nodeId}</Text><Text color={designFlowTheme.accentStrong}>No generation started.</Text></Box>
      : navigation.view === "ready-to-run" ? <Box flexDirection="column"><Text bold>Ready to start</Text><Text color={designFlowTheme.success}>✓ {session.design.label}</Text><Text color={designFlowTheme.success}>✓ {session.destination.value ?? session.destination.label}</Text><Text color={designFlowTheme.accent}>Approval: {session.approval.mode === "designflow" ? "DesignFlow handles approvals" : "Review changes myself"}</Text><Text color={designFlowTheme.accentStrong}>[ Enter ] Start</Text></Box>
      : navigation.view === "execution" ? <ExecutionView session={session} prompt={executionPrompt} />
      : navigation.view === "proposal-review" || navigation.view === "correction-review" ? navigation.review === undefined ? <Text color={designFlowTheme.warning}>Proposal review is unavailable.</Text> : <ProposalReviewView request={navigation.review} selectedAction={navigation.reviewActionIndex} />
      : navigation.view === "diff-view" ? navigation.review === undefined ? <Text color={designFlowTheme.warning}>Diff is unavailable.</Text> : <DiffView review={navigation.review.review} fileIndex={navigation.reviewFileIndex} scrollOffset={navigation.diffScrollOffset} visibleLines={viewerVisibleLines} />
      : navigation.view === "applying" ? <LifecycleResultView title="Applying" sessionLines={["● Applying changes…"]} />
      : navigation.view === "validation-result" ? <LifecycleResultView title="Validation" sessionLines={session.checks.map((check) => `${check.status === "passed" ? "✓" : check.status === "failed" ? "✕" : "○"} ${check.label}`)} />
      : navigation.view === "visual-result" ? <VisualResultPanel result={visualResult} compact selectedAction={navigation.outcomeActionIndex} />
      : navigation.view === "needs-attention" ? <LifecycleResultView title={terminalOutcome?.title ?? "Needs attention"} sessionLines={session.diagnostics.length > 0 ? [...session.diagnostics.slice(0, 8), "No new mutation is started from this screen."] : ["The workflow needs attention.", "No new mutation is started from this screen."]} actions={terminalOutcomeMenuActions(terminalOutcome?.actions ?? []).map((action) => action.label)} selectedAction={navigation.outcomeActionIndex} />
      : navigation.view === "sign-in-required" ? <AuthView navigation={navigation} signingIn={false} />
      : navigation.view === "signing-in" ? <AuthView navigation={navigation} signingIn />
      : navigation.view === "diagnostics-view" ? <LifecycleResultView title="Details" sessionLines={session.diagnostics.slice(0, 12)} />
      : navigation.view === "final-result" ? <LifecycleResultView title={terminalOutcome?.title ?? (session.finalResult?.status === "failure" ? "Needs attention" : "Done")} sessionLines={[session.finalResult?.summary ?? "DesignFlow finished.", session.finalResult?.status === "failure" ? "No new mutation is started from this screen." : "Outputs remain available for inspection."]} actions={terminalOutcomeMenuActions(terminalOutcome?.actions ?? []).map((action) => action.label)} selectedAction={navigation.outcomeActionIndex} />
      : <Box flexDirection="column"><Text bold>{session.ai.status === "pending" ? "Sign in required" : "Ready to start"}</Text><Text>{session.ai.status === "pending" ? "Sign in before starting Design Engineer." : "Press Enter to select a design."}</Text></Box>}
    {navigation.error !== undefined && <Text color={designFlowTheme.danger}>{navigation.error}</Text>}
  </Box>;
}


function CompactOptions({ title, options, active }: { readonly title: string; readonly options: readonly string[]; readonly active: number }): React.JSX.Element {
  return <Box flexDirection="column"><Text bold>{title}</Text>{options.map((option, index) => <Text key={option} color={index === active ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>{index === active ? "›" : " "} {option}</Text>)}</Box>;
}
