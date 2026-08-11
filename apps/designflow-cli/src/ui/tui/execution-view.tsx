import React from "react";
import { Box, Text } from "ink";
import type { DesignFlowSessionView } from "./model";
import { designFlowTheme } from "./theme";
import type { TuiPromptState } from "./text-input";

export function ExecutionView({
  session,
  prompt,
}: {
  readonly session: DesignFlowSessionView;
  readonly prompt?: TuiPromptState | undefined;
}): React.JSX.Element {
  const active = session.activity.find((item) => item.state === "running") ?? session.activity.at(-1);
  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={designFlowTheme.textPrimary}>{session.finalResult?.summary ?? "DesignFlow is working"}</Text>
      {active !== undefined && <Box flexDirection="column" marginTop={2}>
        <Text color={active.state === "failed" ? designFlowTheme.danger : designFlowTheme.accentStrong} bold>{actorLabel(active.actor)}</Text>
        <Text color={active.state === "failed" ? designFlowTheme.danger : designFlowTheme.textPrimary}>{active.state === "running" ? "●" : active.state === "failed" ? "✕" : "✓"} {active.title}</Text>
        {active.detail !== undefined && <Text color={designFlowTheme.textSecondary}>{active.detail}</Text>}
      </Box>}
      {session.attempt !== undefined && <Text color={designFlowTheme.textSecondary}>Attempt {session.attempt.current} of {session.attempt.maximum}</Text>}
      {session.checks.length > 0 && <Box flexDirection="column" marginTop={1}>
        <Text bold>DesignFlow validation</Text>
        {session.checks.map((check) => <Text key={check.id} color={check.status === "failed" ? designFlowTheme.danger : check.status === "passed" ? designFlowTheme.success : designFlowTheme.textSecondary}>{check.status === "passed" ? "✓" : check.status === "failed" ? "✕" : check.status === "running" ? "●" : "○"} {check.label}</Text>)}
      </Box>}
      {session.activity.length > 1 && <Box flexDirection="column" marginTop={1}>
        {session.activity.slice(-6, -1).map((item) => <Text key={`${item.actor}:${item.title}`} color={item.state === "failed" ? designFlowTheme.danger : item.state === "completed" ? designFlowTheme.success : designFlowTheme.textSecondary}>{item.state === "completed" ? "✓" : "○"} {item.title}</Text>)}
      </Box>}
      {session.diagnostics.length > 0 && <Box flexDirection="column" marginTop={1}>
        {session.diagnostics.slice(0, 8).map((line, index) => <Text key={`${index}:${line}`} color={session.finalResult?.status === "failure" ? designFlowTheme.danger : designFlowTheme.textSecondary}>{line}</Text>)}
      </Box>}
      {prompt !== undefined && <Box flexDirection="column" marginTop={2} borderStyle="single" borderColor={designFlowTheme.focus} paddingX={1}>
        <Text bold color={designFlowTheme.accentStrong}>{prompt.question}</Text>
        {prompt.options !== undefined
          ? prompt.options.map((option, index) => <Text key={option} color={index === prompt.optionIndex ? designFlowTheme.accentStrong : designFlowTheme.textPrimary}>{index === prompt.optionIndex ? "›" : " "} {option}</Text>)
          : <Text wrap="truncate">{prompt.value.slice(0, prompt.cursorIndex)}▌{prompt.value.slice(prompt.cursorIndex)}</Text>}
      </Box>}
    </Box>
  );
}

function actorLabel(actor: DesignFlowSessionView["activity"][number]["actor"]): string {
  return {
    designflow: "DesignFlow",
    coordinator: "DesignFlow",
    "specification-ai": "Specification AI",
    "implementation-ai": "Implementation AI",
    "visual-validation-ai": "Visual Validation AI",
    "visual-correction-ai": "Visual Correction AI",
  }[actor];
}
