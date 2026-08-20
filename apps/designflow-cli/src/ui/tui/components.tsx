import React from "react";
import { Box, Text } from "ink";
import type { DesignFlowSessionView, WorkflowStageView } from "./model";
import { designFlowTheme, statusColor } from "./theme";
import type { TuiNavigationState, TuiView } from "./navigation";
import { ExecutionView } from "./execution-view";
import { CompactView } from "./compact-view";
import { renderVisibleUrlWindow, urlInputBoxWidth, urlInputContentWidth, visibleUrlWindow } from "./url-window";
import { OutputViewer } from "./output-viewer";
import { DiffView, LifecycleResultView, ProposalReviewView } from "./review-view";
import type { ArtifactViewerDocument } from "./artifact-viewer";
import type { VisualResultView } from "../../services/visual-result";
import { VisualResultPanel } from "./visual-result-view";
import type { TuiPromptState } from "./text-input";
import { terminalOutcomeMenuActions, terminalOutcomeStatusHintForActions, visualResultStatusHint, type TerminalOutcomeView } from "./outcome";
import { AuthView } from "./auth-view";
export { visibleUrlWindow } from "./url-window";

export interface ShellProps {
  readonly session: DesignFlowSessionView;
  readonly navigation: TuiNavigationState;
  readonly helpOpen: boolean;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly selectedStage: number;
  readonly selectedOutput: number;
  readonly compact: boolean;
  readonly destinationVisibleCount: number;
  readonly viewerDocument?: ArtifactViewerDocument | undefined;
  readonly viewerVisibleLines: number;
  readonly selectedOutputView?: DesignFlowSessionView["outputs"][number] | undefined;
  readonly executionPrompt?: TuiPromptState | undefined;
  readonly visualResult?: VisualResultView | undefined;
  readonly terminalColumns: number;
  readonly executionBusy: boolean;
  readonly terminalOutcome?: TerminalOutcomeView | undefined;
  readonly freshMode?: boolean;
}

export function Shell({
  session,
  navigation,
  helpOpen,
  focusArea,
  selectedStage,
  selectedOutput,
  compact,
  destinationVisibleCount,
  viewerDocument,
  viewerVisibleLines,
  selectedOutputView,
  executionPrompt,
  visualResult,
  terminalColumns,
  executionBusy,
  terminalOutcome,
  freshMode = false,
}: ShellProps): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header session={session} executionBusy={executionBusy} terminalOutcome={terminalOutcome} freshMode={freshMode} />
      {helpOpen ? (
        <HelpView />
      ) : compact ? (
        <CompactView
          session={session}
          navigation={navigation}
          focusArea={focusArea}
          destinationVisibleCount={destinationVisibleCount}
          selectedOutput={selectedOutput}
          viewerDocument={viewerDocument}
          viewerVisibleLines={viewerVisibleLines}
          selectedOutputView={selectedOutputView}
          executionPrompt={executionPrompt}
          visualResult={visualResult}
          terminalColumns={terminalColumns}
          terminalOutcome={terminalOutcome}
          freshMode={freshMode}
        />
      ) : (
        <Box flexGrow={1} flexDirection="row" overflow="hidden">
          {freshMode ? <FreshMainPanel navigation={navigation} terminalColumns={terminalColumns} /> : <>
            <Sidebar
              session={session}
              focusArea={focusArea}
              selectedStage={selectedStage}
              selectedOutput={selectedOutput}
            />
            <MainPanel
              session={session}
              navigation={navigation}
              focusArea={focusArea}
              destinationVisibleCount={destinationVisibleCount}
              selectedOutputView={selectedOutputView}
              viewerDocument={viewerDocument}
              viewerVisibleLines={viewerVisibleLines}
              viewerScrollOffset={navigation.outputScrollOffset}
              viewerDetails={navigation.outputDetails}
              executionPrompt={executionPrompt}
              visualResult={visualResult}
              terminalColumns={terminalColumns}
              terminalOutcome={terminalOutcome}
            />
          </>}
        </Box>
      )}
      <StatusBar compact={compact} helpOpen={helpOpen} view={navigation.view} authRequired={session.ai.status === "pending"} canImprove={visualResult?.canImprove === true} hasVisualReport={visualResult?.reportAvailable === true} hasOutputs={session.outputs.length > 0} executionBusy={executionBusy} terminalOutcome={terminalOutcome} />
    </Box>
  );
}
export function Header({ session, executionBusy, terminalOutcome, freshMode = false }: { readonly session: DesignFlowSessionView; readonly executionBusy: boolean; readonly terminalOutcome?: TerminalOutcomeView | undefined; readonly freshMode?: boolean }): React.JSX.Element {
  const status = freshMode ? "Ready" : headerStatus(session, executionBusy, terminalOutcome);

  return (
    <Box
      borderStyle="single"
      borderBottom
      borderColor={designFlowTheme.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color={designFlowTheme.accentStrong}>DesignFlow</Text>
      <Text color={designFlowTheme.textSecondary}>{freshMode ? "Fresh UI MVP" : session.project.name}</Text>
      <Text color={status === "Ready" || status === "Done" ? designFlowTheme.success : status === "Running" ? designFlowTheme.accent : designFlowTheme.warning}>
        {status}
      </Text>
    </Box>
  );
}

export function headerStatus(
  session: DesignFlowSessionView,
  executionBusy: boolean,
  terminalOutcome?: TerminalOutcomeView,
): "Ready" | "Running" | "Needs attention" | "Cancelled" | "Done" | "Sign in required" {
  return session.ai.status === "pending"
    ? "Sign in required"
    : terminalOutcome?.kind === "completed"
      ? "Done"
      : terminalOutcome?.kind === "cancelled"
        ? "Cancelled"
        : terminalOutcome !== undefined || session.workflow.status === "unavailable"
          ? "Needs attention"
          : executionBusy || session.workflow.status === "active"
            ? "Running"
            : session.project.status === "ready" ? "Ready" : "Needs attention";
}
export function Sidebar({
  session,
  focusArea,
  selectedStage,
  selectedOutput,
}: {
  readonly session: DesignFlowSessionView;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly selectedStage: number;
  readonly selectedOutput: number;
}): React.JSX.Element {
  return (
    <Box
      width={28}
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderRight
      borderColor={focusArea === "workflow" || focusArea === "outputs" ? designFlowTheme.focus : designFlowTheme.border}
    >
      <Text bold color={designFlowTheme.textSecondary}>WORKFLOW</Text>
      <WorkflowList stages={session.workflow.stages} selectedStage={selectedStage} />
      <Box marginTop={1} flexDirection="column">
        <Text bold color={designFlowTheme.textSecondary}>OUTPUTS</Text>
        <OutputsList session={session} selectedOutput={selectedOutput} focused={focusArea === "outputs"} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold color={designFlowTheme.textSecondary}>SELECTION</Text>
        <Text color={session.design.status === "ready" ? designFlowTheme.success : designFlowTheme.muted}>
          {session.design.status === "ready" ? "✓" : "·"} {session.design.label}
        </Text>
        <Text color={session.destination.status === "ready" ? designFlowTheme.success : designFlowTheme.muted}>
          {session.destination.status === "ready" ? "✓" : "·"} {session.destination.value ?? session.destination.label}
        </Text>
        <Text color={designFlowTheme.accent}>{session.approval.mode === "designflow" ? "↗" : "·"} {session.approval.mode === "designflow" ? "DesignFlow approvals" : "Manual approval"}</Text>
      </Box>
    </Box>
  );
}
export function WorkflowList({
  stages,
  selectedStage,
}: {
  readonly stages: readonly WorkflowStageView[];
  readonly selectedStage: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      {stages.map((stage, index) => (
        <Box key={stage.id} flexDirection="column">
          <Text color={index === selectedStage ? designFlowTheme.focus : statusColor(stage.status)}>
            {index === selectedStage ? ">" : " "} {stageMarker(stage)} {stage.label}
          </Text>
          {stage.note !== undefined && (
            <Text color={designFlowTheme.warning}>    {stage.note}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
export function OutputsList({
  session,
  selectedOutput,
  focused,
}: {
  readonly session: DesignFlowSessionView;
  readonly selectedOutput: number;
  readonly focused: boolean;
}): React.JSX.Element {
  if (session.outputs.length === 0) {
    return <Text color={designFlowTheme.muted}>No outputs yet</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {session.outputs.map((output, index) => (
        <Text key={output.id} color={index === selectedOutput && focused ? designFlowTheme.accentStrong : output.status === "available" ? designFlowTheme.textPrimary : designFlowTheme.muted}>
          {index === selectedOutput && focused ? "›" : " "} {output.status === "available" ? "✓" : "○"} {output.label}
        </Text>
      ))}
    </Box>
  );
}
export function MainPanel({
  session,
  navigation,
  focusArea,
  destinationVisibleCount,
  selectedOutputView,
  viewerDocument,
  viewerVisibleLines,
  viewerScrollOffset,
  viewerDetails,
  executionPrompt,
  visualResult,
  terminalColumns,
  terminalOutcome,
}: {
  readonly session: DesignFlowSessionView;
  readonly navigation: TuiNavigationState;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly destinationVisibleCount: number;
  readonly selectedOutputView?: DesignFlowSessionView["outputs"][number] | undefined;
  readonly viewerDocument?: ArtifactViewerDocument | undefined;
  readonly viewerVisibleLines: number;
  readonly viewerScrollOffset: number;
  readonly viewerDetails: boolean;
  readonly executionPrompt?: TuiPromptState | undefined;
  readonly visualResult?: VisualResultView | undefined;
  readonly terminalColumns: number;
  readonly terminalOutcome?: TerminalOutcomeView | undefined;
}): React.JSX.Element {
  return (
    <Box
      flexGrow={1}
      flexDirection="column"
      paddingX={3}
      paddingY={2}
      borderColor={focusArea === "main" ? designFlowTheme.focus : undefined}
    >
      {navigation.view === "design-selection" ? (
        <DesignSelectionView navigation={navigation} />
      ) : navigation.view === "figma-url-entry" ? (
        <FigmaUrlEntryView navigation={navigation} terminalColumns={terminalColumns} />
      ) : navigation.view === "destination-selection" ? (
        <DestinationSelectionView
          navigation={navigation}
          visibleCount={destinationVisibleCount}
        />
      ) : navigation.view === "approval-mode" ? (
        <ApprovalModeView navigation={navigation} />
      ) : navigation.view === "ready-to-run" ? (
        <ReadyToRunView session={session} />
      ) : navigation.view === "execution" ? (
        <ExecutionView session={session} prompt={executionPrompt} />
      ) : navigation.view === "proposal-review" || navigation.view === "correction-review" ? (
        navigation.review === undefined ? <Text color={designFlowTheme.warning}>Proposal review is unavailable.</Text> : <ProposalReviewView request={navigation.review} selectedAction={navigation.reviewActionIndex} />
      ) : navigation.view === "diff-view" ? (
        navigation.review === undefined ? <Text color={designFlowTheme.warning}>Diff is unavailable.</Text> : <DiffView review={navigation.review.review} fileIndex={navigation.reviewFileIndex} scrollOffset={navigation.diffScrollOffset} visibleLines={Math.max(1, viewerVisibleLines)} />
      ) : navigation.view === "applying" ? (
        <LifecycleResultView title="Applying" sessionLines={["✓ Snapshot and validation are controlled by DesignFlow.", "● Applying changes…"]} />
      ) : navigation.view === "validation-result" ? (
        <LifecycleResultView title="Validation" sessionLines={session.checks.map((check) => `${check.status === "passed" ? "✓" : check.status === "failed" ? "✕" : "○"} ${check.label}`)} />
      ) : navigation.view === "visual-result" ? (
        <VisualResultPanel result={visualResult} selectedAction={navigation.outcomeActionIndex} />
      ) : navigation.view === "needs-attention" ? (
        <LifecycleResultView title={terminalOutcome?.title ?? "Needs attention"} sessionLines={outcomeLines(session, true)} actions={terminalOutcomeMenuActions(terminalOutcome?.actions ?? []).map((action) => action.label)} selectedAction={navigation.outcomeActionIndex} />
      ) : navigation.view === "diagnostics-view" ? (
        <LifecycleResultView
          title="Details"
          sessionLines={(session.technicalDetails.length > 0 ? session.technicalDetails : session.diagnostics)
            .slice(navigation.outputScrollOffset, navigation.outputScrollOffset + Math.max(1, viewerVisibleLines))}
        />
      ) : navigation.view === "final-result" ? (
        <LifecycleResultView title={terminalOutcome?.title ?? (session.finalResult?.status === "failure" ? "Needs attention" : "Done")} sessionLines={outcomeLines(session, session.finalResult?.status === "failure")} actions={terminalOutcomeMenuActions(terminalOutcome?.actions ?? []).map((action) => action.label)} selectedAction={navigation.outcomeActionIndex} />
      ) : navigation.view === "output-viewer" ? (
        <OutputViewer output={selectedOutputView} document={viewerDocument} scrollOffset={viewerScrollOffset} visibleLines={viewerVisibleLines} details={viewerDetails} />
      ) : navigation.view === "sign-in-required" || navigation.view === "signing-in" ? (
        <AuthView navigation={navigation} signingIn={navigation.view === "signing-in"} />
      ) : (
        <StartView session={session} focused={focusArea === "main"} />
      )}
    </Box>
  );
}

function FreshMainPanel({
  navigation,
  terminalColumns,
}: {
  readonly navigation: TuiNavigationState;
  readonly terminalColumns: number;
}): React.JSX.Element {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2}>
      {navigation.view === "figma-url-entry" ? (
        <FigmaUrlEntryView navigation={navigation} terminalColumns={terminalColumns} />
      ) : navigation.view === "ready-to-generate" && navigation.freshState !== undefined ? (
        navigation.freshEvidence === undefined ? (
          <Box flexDirection="column">
            <Text bold color={designFlowTheme.textPrimary}>Ready to generate</Text>
            <Text color={designFlowTheme.success}>✓ {navigation.freshState.design.label}</Text>
            <Text color={designFlowTheme.textSecondary}>Frame node: {navigation.freshState.nodeId}</Text>
            {navigation.loading === "fresh-evidence" && <Text color={designFlowTheme.accent}>Retrieving authoritative Figma evidence…</Text>}
            <Text color={designFlowTheme.accentStrong}>No generation started. Press Esc to choose another source.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold color={designFlowTheme.textPrimary}>Figma evidence ready</Text>
            <Text color={designFlowTheme.success}>✓ {navigation.freshEvidence.frame.name}</Text>
            <Text color={designFlowTheme.textSecondary}>Frame node: {navigation.freshEvidence.frame.id}</Text>
            <Text color={designFlowTheme.textSecondary}>Size: {navigation.freshEvidence.frame.width} × {navigation.freshEvidence.frame.height}</Text>
            {navigation.loading === "fresh-scaffold" && <Text color={designFlowTheme.accent}>Creating deterministic project scaffold…</Text>}
            {navigation.freshProject !== undefined && <Text color={designFlowTheme.success}>Project: {navigation.freshProject.targetPath}</Text>}
            <Text color={designFlowTheme.accentStrong}>No generation started. Press Esc to choose another source.</Text>
          </Box>
        )
      ) : (
        <DesignSelectionView navigation={navigation} fresh />
      )}
      {navigation.error !== undefined && navigation.view !== "design-selection" && <Text color={designFlowTheme.danger}>{navigation.error}</Text>}
    </Box>
  );
}

export function StartView({
  session,
  focused,
}: {
  readonly session: DesignFlowSessionView;
  readonly focused: boolean;
}): React.JSX.Element {
  const canStart = session.project.status === "ready" && session.ai.status === "ready";
  const authRequired = session.ai.status === "pending";

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={designFlowTheme.textPrimary}>{authRequired ? "Sign in required" : "Ready to start"}</Text>
      <Text color={designFlowTheme.textSecondary}>Prepare the next DesignFlow run.</Text>

      <Box flexDirection="column" marginTop={2}>
        <ReadinessRow label="Project" value={session.project.name} status={session.project.status} />
        <ReadinessRow label="Figma" value={session.figma.label} status={session.figma.status} />
        <ReadinessRow label="AI" value={session.ai.label} status={session.ai.status} />
        <ReadinessRow label="Design" value={session.design.label} status={session.design.status} />
        <ReadinessRow label="Destination" value={session.destination.value ?? session.destination.label} status={session.destination.status} />
        <ReadinessRow label="Approval" value={session.approval.mode === "designflow" ? "DesignFlow handles approvals" : "Review changes myself"} status="ready" />
      </Box>

      <Box marginTop={2}>
        <Text color={focused ? designFlowTheme.accentStrong : designFlowTheme.textSecondary} bold={focused}>
          {focused ? "[" : " "} {canStart ? "Start Design Engineer" : authRequired ? "Sign in to start Design Engineer" : "Run from a project directory"} {focused ? "]" : " "}
        </Text>
      </Box>

      {!canStart && (
        <Box marginTop={1}>
          <Text color={designFlowTheme.warning}>{authRequired ? "Sign in before starting Design Engineer." : "Open DesignFlow from a supported project to begin."}</Text>
        </Box>
      )}
    </Box>
  );
}
export function DesignSelectionView({
  navigation,
  fresh = false,
}: {
  readonly navigation: TuiNavigationState;
  readonly fresh?: boolean;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>{fresh ? "Select a Figma frame" : "Select design"}</Text>
      <Text color={designFlowTheme.textSecondary}>{fresh ? "Use the current selection, or paste a Figma frame URL." : "Use the frame selected in Figma, or paste a Figma URL."}</Text>
      <Box flexDirection="column" marginTop={2}>
        {[
          "Current Figma selection",
          fresh ? "Paste Figma frame URL" : "Paste Figma URL",
        ].map((label, index) => (
          <Text key={label} color={index === navigation.designOption ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>
            {index === navigation.designOption ? "›" : " "} {label}
          </Text>
        ))}
      </Box>
      {navigation.loading === "current-selection" && <InlineMessage tone="muted">Reading the current Figma selection…</InlineMessage>}
      {navigation.error !== undefined && <InlineMessage tone="danger">{navigation.error}</InlineMessage>}
    </Box>
  );
}
export function FigmaUrlEntryView({
  navigation,
  terminalColumns,
}: {
  readonly navigation: TuiNavigationState;
  readonly terminalColumns: number;
}): React.JSX.Element {
  const contentWidth = urlInputContentWidth(terminalColumns, false);
  const window = visibleUrlWindow(navigation.urlValue, navigation.urlCursor, contentWidth);

  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Paste Figma URL</Text>
      <Text color={designFlowTheme.textSecondary}>Press Enter to continue. Your URL is validated by the existing Figma parser.</Text>
      <Box marginTop={2} width={urlInputBoxWidth(terminalColumns, false)} flexGrow={0} flexShrink={0} overflow="hidden" borderStyle="single" borderColor={designFlowTheme.focus} paddingX={1}>
        <Text color={designFlowTheme.textPrimary} wrap="truncate">
          {renderVisibleUrlWindow(window)}
        </Text>
      </Box>
      {navigation.urlError !== undefined && <InlineMessage tone="danger">{navigation.urlError}</InlineMessage>}
    </Box>
  );
}
export function DestinationSelectionView({
  navigation,
  visibleCount,
}: {
  readonly navigation: TuiNavigationState;
  readonly visibleCount: number;
}): React.JSX.Element {
  const start = navigation.destinationScrollOffset;
  const candidates = navigation.destinationCandidates.slice(start, start + Math.max(1, visibleCount));

  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Where should this design go?</Text>
      <Text color={designFlowTheme.textSecondary}>Choose an existing destination or create a new one.</Text>
      <Box flexDirection="column" marginTop={2}>
        {candidates.map((candidate, offset) => {
          const index = start + offset;
          const active = index === navigation.destinationIndex;
          return (
            <Text key={`${candidate.kind}:${candidate.label}`} color={active ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>
              {active ? "›" : " "} {candidate.label}
            </Text>
          );
        })}
      </Box>
      {navigation.loading === "destinations" && <InlineMessage tone="muted">Inspecting project destinations…</InlineMessage>}
      {navigation.error !== undefined && <InlineMessage tone="danger">{navigation.error}</InlineMessage>}
      {navigation.destinationCandidates.length > Math.max(1, visibleCount) && (
        <Text color={designFlowTheme.muted}>Showing {start + 1}–{Math.min(start + Math.max(1, visibleCount), navigation.destinationCandidates.length)} of {navigation.destinationCandidates.length}</Text>
      )}
    </Box>
  );
}

export function ApprovalModeView({ navigation }: { readonly navigation: TuiNavigationState }): React.JSX.Element {
  const options = [
    {
      label: "Review changes myself",
      detail: "You will review every proposed code change before DesignFlow writes it.",
    },
    {
      label: "Let DesignFlow handle approvals",
      detail: "DesignFlow may apply validated changes within this run's selected scope. Unsafe changes still stop for review.",
    },
  ];
  const selected = options[navigation.approvalOption] ?? options[0]!;
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Approval mode</Text>
      <Text color={designFlowTheme.textSecondary}>Choose who authorizes validated changes.</Text>
      <Box flexDirection="column" marginTop={2}>
        {options.map((option, index) => (
          <Text key={option.label} color={index === navigation.approvalOption ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>
            {index === navigation.approvalOption ? "›" : " "} {option.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={2} flexDirection="column">
        <Text color={designFlowTheme.textSecondary}>{selected.detail}</Text>
        {navigation.approvalMode === "designflow" && <Text color={designFlowTheme.warning}>AI agents cannot approve their own work.</Text>}
      </Box>
    </Box>
  );
}
export function ReadyToRunView({
  session,
}: {
  readonly session: DesignFlowSessionView;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Ready to start</Text>
      <Text color={designFlowTheme.textSecondary}>Review the selected design and destination.</Text>
      <Box flexDirection="column" marginTop={2}>
        <ReadinessRow label="Design" value={session.design.label} status={session.design.status} />
        <ReadinessRow label="Destination" value={session.destination.value ?? session.destination.label} status={session.destination.status} />
        <ReadinessRow label="Project" value={session.project.name} status={session.project.status} />
        <ReadinessRow label="Figma" value={session.figma.label} status={session.figma.status} />
        <ReadinessRow label="AI" value={session.ai.label} status={session.ai.status} />
        <ReadinessRow label="Approval" value={session.approval.mode === "designflow" ? "DesignFlow handles approvals" : "Review changes myself"} status="ready" />
      </Box>
      <Box marginTop={2}>
        <Text color={designFlowTheme.accentStrong} bold>[ Start Design Engineer ]</Text>
      </Box>
    </Box>
  );
}

export function HelpView(): React.JSX.Element {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2}>
      <Text bold color={designFlowTheme.accentStrong}>DesignFlow help</Text>
      <Box flexDirection="column" marginTop={2}>
        <Text><Text color={designFlowTheme.accent}>Enter</Text>  activate the current selection</Text>
        <Text><Text color={designFlowTheme.accent}>↑ / ↓</Text>  move through selections</Text>
        <Text><Text color={designFlowTheme.accent}>Tab</Text>  move between workflow and main areas</Text>
        <Text><Text color={designFlowTheme.accent}>?</Text>  open or close this help</Text>
        <Text><Text color={designFlowTheme.accent}>Esc</Text>  go back</Text>
        <Text><Text color={designFlowTheme.accent}>q</Text>  quit when not editing text</Text>
        <Text><Text color={designFlowTheme.accent}>Ctrl+C</Text>  request safe cancellation</Text>
        <Text color={designFlowTheme.textSecondary}>Approval modes</Text>
        <Text>Review changes myself — you approve each proposed change.</Text>
        <Text>Let DesignFlow handle approvals — only validated in-scope changes may be auto-approved; AI agents cannot approve their own work.</Text>
        <Text color={designFlowTheme.textSecondary}>Sign in</Text>
        <Text>DesignFlow uses your account to access its managed AI service. Existing sessions are reused automatically.</Text>
      </Box>
    </Box>
  );
}

export function StatusBar({
  compact,
  helpOpen,
  view,
  authRequired,
  canImprove,
  hasVisualReport,
  hasOutputs,
  executionBusy,
  terminalOutcome,
}: {
  readonly compact: boolean;
  readonly helpOpen: boolean;
  readonly view: TuiView;
  readonly authRequired: boolean;
  readonly canImprove?: boolean;
  readonly hasVisualReport: boolean;
  readonly hasOutputs: boolean;
  readonly executionBusy: boolean;
  readonly terminalOutcome?: TerminalOutcomeView | undefined;
}): React.JSX.Element {
  const outcomeHint = terminalOutcomeStatusHintForActions(terminalOutcome?.actions ?? []);
  const diagnosticsHint = "? Help   Esc Back   q Quit";
  const hint = compact
    ? view === "diagnostics-view"
      ? diagnosticsHint
      : view === "sign-in-required"
        ? "Enter Sign in   ? Help   q Quit"
        : view === "signing-in"
          ? "Ctrl+C Cancel   ? Help   q Quit"
      : terminalOutcome !== undefined
      ? outcomeHint
      : view === "output-viewer"
      ? "Compact viewer — ↑↓/jk Scroll   PgUp/PgDn   Home/End   Esc Back"
      : authRequired
        ? "Enter Sign in   ? Help   q Quit"
        : "Compact mode — resize for the full shell"
    : helpOpen
      ? "Esc Close help"
      : view === "design-selection"
        ? "↑↓ Navigate   Enter Select   Esc Back"
        : view === "figma-url-entry"
          ? "Enter Continue   Esc Back"
      : view === "sign-in-required"
        ? "Enter Sign in   ? Help   q Quit"
      : view === "signing-in"
        ? "Ctrl+C Cancel   ? Help   q Quit"
      : view === "destination-selection"
            ? "↑↓ Navigate   Enter Select   Esc Back"
      : view === "approval-mode"
          ? "↑↓ Navigate   Enter Select   Esc Back"
      : view === "ready-to-generate"
              ? "Esc Choose another source   ? Help   q Quit"
      : view === "ready-to-run"
              ? "Enter Start   Esc Change destination   ? Help   q Quit"
                : view === "execution"
                ? executionBusy ? "? Help   Ctrl+C Cancel" : outcomeHint
                : view === "diagnostics-view"
                  ? diagnosticsHint
                : view === "proposal-review" || view === "correction-review"
                  ? "↑↓ Navigate   Enter Select   d View diff   Esc Back"
                  : view === "diff-view"
                    ? "↑↓/jk Scroll   PgUp/PgDn   Home/End   [/] File   Esc Back"
                    : view === "visual-result"
                      ? visualResultStatusHint(hasVisualReport, canImprove === true, hasOutputs)
                      : view === "needs-attention" || view === "final-result" || view === "validation-result"
                        ? outcomeHint
              : view === "output-viewer"
                  ? `↑↓/jk Scroll   PgUp/PgDn   Home/End   d Details   Esc Back${executionBusy ? "" : "   q Quit"}`
              : view === "start" && authRequired
                ? "Enter Sign in   ? Help   q Quit"
                : "Enter Start   ? Help   q Quit";

  return (
    <Box borderStyle="single" borderTop borderColor={designFlowTheme.border} paddingX={1}>
      <Text color={designFlowTheme.textSecondary}>{hint}</Text>
    </Box>
  );
}

function outcomeLines(session: DesignFlowSessionView, failure: boolean): readonly string[] {
  if (session.diagnostics.length > 0) {
    return [...session.diagnostics.slice(0, 8), ...(failure ? ["No new mutation is started from this screen."] : [])];
  }
  return [session.finalResult?.summary ?? "DesignFlow finished.", failure ? "No new mutation is started from this screen." : "Outputs remain available for inspection."];
}

function ReadinessRow({
  label,
  value,
  status,
}: {
  readonly label: string;
  readonly value: string;
  readonly status: Parameters<typeof statusColor>[0];
}): React.JSX.Element {
  const icon = status === "ready" ? "✓" : status === "idle" ? "·" : "!";

  return (
    <Box>
      <Text color={statusColor(status)}>{icon} </Text>
      <Box width={16}><Text color={designFlowTheme.textSecondary}>{label}</Text></Box>
      <Text color={designFlowTheme.textPrimary}>{value}</Text>
    </Box>
  );
}

function InlineMessage({
  tone,
  children,
}: {
  readonly tone: "danger" | "muted";
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text color={tone === "danger" ? designFlowTheme.danger : designFlowTheme.muted}>{children}</Text>
    </Box>
  );
}

export function stageMarker(stage: WorkflowStageView): string {
  if (stage.status === "complete") return "✓";
  if (stage.status === "active") return "→";
  if (stage.status === "needs-attention") return "!";
  return "○";
}
