import React, { useEffect, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import type { DesignFlowSessionView } from "./model";
import { isCompactTerminal, mapTuiKey, reduceTuiInteraction, type TuiInteractionState } from "./keys";
import { Shell } from "./components";

export type TuiAction = "start" | "quit";

export interface TuiAppProps {
  readonly session: DesignFlowSessionView;
  readonly onAction: (action: TuiAction) => void;
  readonly onInterrupt: () => void;
}

export function App({ session, onAction, onInterrupt }: TuiAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  const [interaction, setInteraction] = useState<TuiInteractionState>({
    helpOpen: false,
    focusArea: "main",
    selectedStage: 0,
  });

  useEffect(() => {
    const onResize = (): void => {
      setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  useInput((input, key) => {
    const action = mapTuiKey(input, key);

    if (interaction.helpOpen) {
      if (action === "back") setInteraction((current) => ({ ...current, helpOpen: false }));
      else if (action === "help") setInteraction((current) => ({ ...current, helpOpen: false }));
      else if (action === "quit") {
        onAction("quit");
        exit();
      }
      return;
    }

    if (action === "help") {
      setInteraction((current) => ({ ...current, helpOpen: true }));
      return;
    }

    if (action === "quit") {
      onAction("quit");
      exit();
      return;
    }

    if (action === "interrupt") {
      onInterrupt();
      onAction("quit");
      exit();
      return;
    }

    if (action === "activate") {
      if (interaction.focusArea === "main" && session.project.status === "ready") {
        onAction("start");
        exit();
      }
      return;
    }

    setInteraction((current) => reduceTuiInteraction(current, action, session.workflow.stages.length));
  });

  return (
    <Shell
      session={session}
      helpOpen={interaction.helpOpen}
      focusArea={interaction.focusArea}
      selectedStage={interaction.selectedStage}
      compact={isCompactTerminal(size.columns, size.rows)}
    />
  );
}
