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
  readonly executionPrompt?: { readonly question: string; readonly options?: readonly string[]; readonly value: string } | undefined;
  readonly visualResult?: VisualResultView | undefined;
  readonly terminalColumns: number;
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
}: ShellProps): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header session={session} />
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
        />
      ) : (
        <Box flexGrow={1} flexDirection="row" overflow="hidden">
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
          />
        </Box>
      )}
      <StatusBar compact={compact} helpOpen={helpOpen} view={navigation.view} canImprove={visualResult?.canImprove === true} />
    </Box>
  );
}
export function Header({ session }: { readonly session: DesignFlowSessionView }): React.JSX.Element {
  const status = session.project.status === "ready" ? "Ready" : "Needs attention";

  return (
    <Box
      borderStyle="single"
      borderBottom
      borderColor={designFlowTheme.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Text bold color={designFlowTheme.accentStrong}>DesignFlow</Text>
      <Text color={designFlowTheme.textSecondary}>{session.project.name}</Text>
      <Text color={status === "Ready" ? designFlowTheme.success : designFlowTheme.warning}>
        {status}
      </Text>
    </Box>
  );
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
        <Text key={stage.id} color={index === selectedStage ? designFlowTheme.focus : statusColor(stage.status)}>
          {index === selectedStage ? ">" : " "} {stageMarker(stage)} {stage.label}
        </Text>
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
  readonly executionPrompt?: { readonly question: string; readonly options?: readonly string[]; readonly value: string } | undefined;
  readonly visualResult?: VisualResultView | undefined;
  readonly terminalColumns: number;
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
        <VisualResultPanel result={visualResult} />
      ) : navigation.view === "final-result" ? (
        <LifecycleResultView title={session.finalResult?.status === "failure" ? "Needs attention" : "Done"} sessionLines={[session.finalResult?.summary ?? "DesignFlow finished.", session.finalResult?.status === "failure" ? "No new mutation is started from this screen." : "Outputs remain available for inspection."]} />
      ) : navigation.view === "output-viewer" ? (
        <OutputViewer output={selectedOutputView} document={viewerDocument} scrollOffset={viewerScrollOffset} visibleLines={viewerVisibleLines} details={viewerDetails} />
      ) : (
        <StartView session={session} focused={focusArea === "main"} />
      )}
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
  const canStart = session.project.status === "ready";

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={designFlowTheme.textPrimary}>Ready to start</Text>
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
          {focused ? "[" : " "} {canStart ? "Start Design Engineer" : "Run from a project directory"} {focused ? "]" : " "}
        </Text>
      </Box>

      {!canStart && (
        <Box marginTop={1}>
          <Text color={designFlowTheme.warning}>Open DesignFlow from a supported project to begin.</Text>
        </Box>
      )}
    </Box>
  );
}
export function DesignSelectionView({
  navigation,
}: {
  readonly navigation: TuiNavigationState;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold color={designFlowTheme.textPrimary}>Select design</Text>
      <Text color={designFlowTheme.textSecondary}>Use the frame selected in Figma, or paste a Figma URL.</Text>
      <Box flexDirection="column" marginTop={2}>
        {[
          "Current Figma selection",
          "Paste Figma URL",
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
      </Box>
    </Box>
  );
}

export function StatusBar({
  compact,
  helpOpen,
  view,
  canImprove,
}: {
  readonly compact: boolean;
  readonly helpOpen: boolean;
  readonly view: TuiView;
  readonly canImprove?: boolean;
}): React.JSX.Element {
  const hint = compact
    ? view === "output-viewer"
      ? "Compact viewer — ↑↓/jk Scroll   PgUp/PgDn   Home/End   Esc Back"
      : "Compact mode — resize for the full shell"
    : helpOpen
      ? "Esc Close help"
      : view === "design-selection"
        ? "↑↓ Navigate   Enter Select   Esc Back"
        : view === "figma-url-entry"
          ? "Enter Continue   Esc Back"
      : view === "destination-selection"
            ? "↑↓ Navigate   Enter Select   Esc Back"
        : view === "approval-mode"
          ? "↑↓ Navigate   Enter Select   Esc Back"
      : view === "ready-to-run"
              ? "Enter Start   Esc Change destination   ? Help   q Quit"
      : view === "execution"
                ? "? Help   Ctrl+C Cancel   q Quit when complete"
                : view === "proposal-review" || view === "correction-review"
                  ? "↑↓ Navigate   Enter Select   d View diff   Esc Back"
                  : view === "diff-view"
                    ? "↑↓/jk Scroll   PgUp/PgDn   Home/End   [/] File   Esc Back"
                    : view === "visual-result"
                      ? `Enter View report${canImprove ? "   i Improve" : ""}   Tab Outputs   q Quit`
                      : view === "final-result" || view === "validation-result"
                        ? "Enter View report   Tab Outputs   q Quit"
              : view === "output-viewer"
                  ? "↑↓/jk Scroll   PgUp/PgDn   Home/End   d Details   Esc Back"
              : "Enter Start   ? Help   q Quit";

  return (
    <Box borderStyle="single" borderTop borderColor={designFlowTheme.border} paddingX={1}>
      <Text color={designFlowTheme.textSecondary}>{hint}</Text>
    </Box>
  );
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
  return "○";
}
