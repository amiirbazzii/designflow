import React from "react";
import { Box, Text } from "ink";
import type { DesignFlowSessionView, WorkflowStageView } from "./model";
import { designFlowTheme, statusColor } from "./theme";

export interface ShellProps {
  readonly session: DesignFlowSessionView;
  readonly helpOpen: boolean;
  readonly focusArea: "workflow" | "main";
  readonly selectedStage: number;
  readonly compact: boolean;
}

export function Shell({
  session,
  helpOpen,
  focusArea,
  selectedStage,
  compact,
}: ShellProps): React.JSX.Element {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header session={session} />
      {compact ? (
        <CompactView />
      ) : helpOpen ? (
        <HelpView />
      ) : (
        <Box flexGrow={1} flexDirection="row" overflow="hidden">
          <Sidebar
            session={session}
            focusArea={focusArea}
            selectedStage={selectedStage}
          />
          <MainPanel session={session} focusArea={focusArea} />
        </Box>
      )}
      <StatusBar compact={compact} helpOpen={helpOpen} />
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
}: {
  readonly session: DesignFlowSessionView;
  readonly focusArea: "workflow" | "main";
  readonly selectedStage: number;
}): React.JSX.Element {
  return (
    <Box
      width={28}
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderRight
      borderColor={focusArea === "workflow" ? designFlowTheme.focus : designFlowTheme.border}
    >
      <Text bold color={designFlowTheme.textSecondary}>WORKFLOW</Text>
      <WorkflowList stages={session.workflow.stages} selectedStage={selectedStage} />
      <Box marginTop={1} flexDirection="column">
        <Text bold color={designFlowTheme.textSecondary}>OUTPUTS</Text>
        <OutputsList session={session} />
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
}: {
  readonly session: DesignFlowSessionView;
}): React.JSX.Element {
  if (session.outputs.length === 0) {
    return <Text color={designFlowTheme.muted}>No outputs yet</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {session.outputs.map((output) => (
        <Text key={output.id} color={output.status === "available" ? designFlowTheme.textPrimary : designFlowTheme.muted}>
          {output.label}
        </Text>
      ))}
    </Box>
  );
}

export function MainPanel({
  session,
  focusArea,
}: {
  readonly session: DesignFlowSessionView;
  readonly focusArea: "workflow" | "main";
}): React.JSX.Element {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} borderColor={focusArea === "main" ? designFlowTheme.focus : undefined}>
      <StartView session={session} focused={focusArea === "main"} />
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
      <Text color={designFlowTheme.textSecondary}>A calm place to prepare the next DesignFlow run.</Text>

      <Box flexDirection="column" marginTop={2}>
        <ReadinessRow label="Project" value={session.project.name} status={session.project.status} />
        <ReadinessRow label="Figma" value={session.figma.label} status={session.figma.status} />
        <ReadinessRow label="AI" value={session.ai.label} status={session.ai.status} />
        <ReadinessRow label="Design" value={session.design.label} status={session.design.status} />
        <ReadinessRow label="Destination" value={session.destination.label} status={session.destination.status} />
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

export function HelpView(): React.JSX.Element {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2}>
      <Text bold color={designFlowTheme.accentStrong}>DesignFlow help</Text>
      <Box flexDirection="column" marginTop={2}>
        <Text><Text color={designFlowTheme.accent}>Enter</Text>  activate the current selection</Text>
        <Text><Text color={designFlowTheme.accent}>↑ / ↓</Text>  move through workflow stages</Text>
        <Text><Text color={designFlowTheme.accent}>Tab</Text>  move between workflow and main areas</Text>
        <Text><Text color={designFlowTheme.accent}>?</Text>  open this help</Text>
        <Text><Text color={designFlowTheme.accent}>Esc</Text>  close help</Text>
        <Text><Text color={designFlowTheme.accent}>q</Text>  quit when safe</Text>
        <Text><Text color={designFlowTheme.accent}>Ctrl+C</Text>  request safe cancellation</Text>
      </Box>
    </Box>
  );
}

export function StatusBar({
  compact,
  helpOpen,
}: {
  readonly compact: boolean;
  readonly helpOpen: boolean;
}): React.JSX.Element {
  return (
    <Box borderStyle="single" borderTop borderColor={designFlowTheme.border} paddingX={1}>
      <Text color={designFlowTheme.textSecondary}>
        {compact ? "Resize terminal for the full DesignFlow shell" : helpOpen ? "Esc Close help" : "Enter Start   ? Help   q Quit"}
      </Text>
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

export function stageMarker(stage: WorkflowStageView): string {
  if (stage.status === "complete") return "✓";
  if (stage.status === "active") return "→";
  return "○";
}

function CompactView(): React.JSX.Element {
  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      <Text bold color={designFlowTheme.accentStrong}>DesignFlow</Text>
      <Text color={designFlowTheme.warning}>Terminal too small for the full shell.</Text>
      <Text color={designFlowTheme.textSecondary}>Minimum size: 72 columns × 18 rows.</Text>
    </Box>
  );
}
