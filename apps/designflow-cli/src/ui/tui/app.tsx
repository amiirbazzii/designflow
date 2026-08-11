import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import type { DestinationCandidate } from "../../services/destinations";
import type { InteractiveDesign } from "../../services/figma-selection";
import {
  setDesignSelection,
  setDestinationSelection,
  type DesignFlowSessionView as SessionView,
} from "./model";
import {
  backspaceUrlText,
  closeHelp,
  deleteUrlText,
  enterDesignSelection,
  enterDestinationSelection,
  enterUrlEntry,
  initialNavigationState,
  keepSelectionVisible,
  moveListSelection,
  moveUrlCursor,
  navigateBack,
  openHelp,
  setDestinationCandidates,
  setUrlError,
  updateUrlText,
  type TuiNavigationState,
} from "./navigation";
import { isCompactTerminal, mapTuiKey, reduceTuiInteraction, type TuiInteractionState } from "./keys";
import { Shell } from "./components";

export type TuiAction =
  | { readonly type: "start"; readonly projectId?: string; readonly design: InteractiveDesign; readonly destination: DestinationCandidate }
  | { readonly type: "quit" };

export interface TuiSelectionHandlers {
  readonly getCurrentDesign: () => Promise<InteractiveDesign | null>;
  readonly parseFigmaUrl: (value: string) => InteractiveDesign;
  readonly getDestinations: () => Promise<readonly DestinationCandidate[]>;
}

export interface TuiAppProps {
  readonly session: SessionView;
  readonly projectId?: string;
  readonly handlers: TuiSelectionHandlers;
  readonly onAction: (action: TuiAction) => void;
  readonly onInterrupt: () => void;
}

export function App({
  session: initialSession,
  projectId,
  handlers,
  onAction,
  onInterrupt,
}: TuiAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  const [session, setSession] = useState<SessionView>(initialSession);
  const [navigation, setNavigation] = useState<TuiNavigationState>(() => initialNavigationState());
  const [interaction, setInteraction] = useState<TuiInteractionState>({
    helpOpen: false,
    focusArea: "main",
    selectedStage: 0,
  });
  const destinationRequest = useRef(0);
  const handoffStarted = useRef(false);

  useEffect(() => {
    const onResize = (): void => {
      setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const loadDestinations = (design: InteractiveDesign): void => {
    const requestId = destinationRequest.current + 1;
    destinationRequest.current = requestId;
    setNavigation((current) => enterDestinationSelection(current, design));
    void handlers.getDestinations()
      .then((candidates) => {
        if (destinationRequest.current !== requestId) return;
        setNavigation((current) => {
          if (current.view !== "destination-selection") return current;
          return setDestinationCandidates(current, candidates);
        });
      })
      .catch(() => {
        if (destinationRequest.current !== requestId) return;
        setNavigation((current) => ({
          ...current,
          loading: null,
          error: "No destination suggestions available.",
        }));
      });
  };

  const acceptDesign = (design: InteractiveDesign): void => {
    setSession((current) => setDesignSelection(current, design));
    loadDestinations(design);
  };

  const activate = (): void => {
    if (navigation.view === "start") {
      if (session.project.status !== "ready") return;
      setNavigation((current) => enterDesignSelection(current));
      return;
    }

    if (navigation.view === "design-selection") {
      if (navigation.loading !== null) return;
      if (navigation.designOption === 1) {
        setNavigation((current) => enterUrlEntry(current));
        return;
      }

      setNavigation((current) => ({ ...current, loading: "current-selection", error: undefined }));
      void handlers.getCurrentDesign()
        .then((design) => {
          if (design === null) {
            setNavigation((current) => ({
              ...current,
              loading: null,
              error: "Figma selection unavailable. Select a frame in Figma or paste a URL.",
            }));
            return;
          }
          acceptDesign(design);
        })
        .catch(() => {
          setNavigation((current) => ({
            ...current,
            loading: null,
            error: "Figma selection unavailable. Select a frame in Figma or paste a URL.",
          }));
        });
      return;
    }

    if (navigation.view === "figma-url-entry") {
      if (navigation.urlValue.trim().length === 0) {
        setNavigation((current) => setUrlError(current, "Enter a Figma URL to continue."));
        return;
      }
      try {
        acceptDesign(handlers.parseFigmaUrl(navigation.urlValue));
      } catch {
        setNavigation((current) => setUrlError(current, "Invalid Figma URL. Use a Figma design or file URL."));
      }
      return;
    }

    if (navigation.view === "destination-selection") {
      if (navigation.loading !== null) return;
      const destination = navigation.destinationCandidates[navigation.destinationIndex];
      if (destination === undefined) {
        setNavigation((current) => ({ ...current, error: "No destination suggestions available." }));
        return;
      }
      setSession((current) => setDestinationSelection(current, destination));
      setNavigation((current) => ({ ...current, view: "ready-to-run", error: undefined }));
      return;
    }

    if (navigation.view === "ready-to-run" && navigation.design !== undefined) {
      const destination = navigation.destinationCandidates[navigation.destinationIndex];
      if (destination === undefined || handoffStarted.current) return;
      handoffStarted.current = true;
      onAction({ type: "start", ...(projectId === undefined ? {} : { projectId }), design: navigation.design, destination });
      exit();
    }
  };

  const handleUrlInput = (input: string, key: Parameters<typeof mapTuiKey>[1]): void => {
    if (key.backspace || input === "\b" || input === "\u007f") {
      setNavigation((current) => backspaceUrlText(current));
      return;
    }
    if (key.delete) {
      setNavigation((current) => deleteUrlText(current));
      return;
    }
    if (key.leftArrow) {
      setNavigation((current) => moveUrlCursor(current, -1));
      return;
    }
    if (key.rightArrow) {
      setNavigation((current) => moveUrlCursor(current, 1));
      return;
    }
    if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
      setNavigation((current) => updateUrlText(current, input));
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onInterrupt();
      onAction({ type: "quit" });
      exit();
      return;
    }

    if (navigation.view === "figma-url-entry") {
      if (key.escape) {
        setNavigation((current) => navigateBack(current));
      } else if (key.return || input === "\n" || input === "\r") {
        activate();
      } else {
        handleUrlInput(input, key);
      }
      return;
    }

    const action = mapTuiKey(input, key);
    if (navigation.view === "help") {
      if (action === "back" || action === "help") setNavigation((current) => closeHelp(current));
      else if (action === "quit") {
        onAction({ type: "quit" });
        exit();
      }
      return;
    }

    if (action === "help") {
      setNavigation((current) => openHelp(current));
      return;
    }
    if (action === "quit") {
      onAction({ type: "quit" });
      exit();
      return;
    }
    if (action === "back") {
      setNavigation((current) => navigateBack(current));
      return;
    }
    if (action === "activate") {
      if (interaction.focusArea === "main") activate();
      return;
    }
    if (action === "next-focus" || action === "previous-focus") {
      setInteraction((current) => reduceTuiInteraction(current, action, session.workflow.stages.length));
      return;
    }

    if (navigation.view === "design-selection" && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      setNavigation((current) => ({
        ...current,
        designOption: moveListSelection(current.designOption, 2, action === "up" ? -1 : 1),
      }));
      return;
    }

    if (navigation.view === "destination-selection" && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      const delta = action === "up" ? -1 : 1;
      setNavigation((current) => {
        const index = moveListSelection(current.destinationIndex, current.destinationCandidates.length, delta);
        const visibleCount = Math.max(1, size.rows - (isCompactTerminal(size.columns, size.rows) ? 8 : 14));
        return {
          ...current,
          destinationIndex: index,
          destinationScrollOffset: keepSelectionVisible(index, current.destinationScrollOffset, visibleCount),
        };
      });
      return;
    }

    setInteraction((current) => reduceTuiInteraction(current, action, session.workflow.stages.length));
  });

  const compact = isCompactTerminal(size.columns, size.rows);
  const visibleCount = Math.max(1, size.rows - (compact ? 8 : 14));

  return (
    <Shell
      session={session}
      navigation={navigation}
      helpOpen={navigation.view === "help"}
      focusArea={interaction.focusArea}
      selectedStage={interaction.selectedStage}
      compact={compact}
      destinationVisibleCount={visibleCount}
    />
  );
}
