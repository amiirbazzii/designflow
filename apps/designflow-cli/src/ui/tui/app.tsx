import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import type { DestinationCandidate } from "../../services/destinations";
import type { InteractiveDesign } from "../../services/figma-selection";
import {
  setDesignSelection,
  setDestinationSelection,
  setApprovalMode,
  setExecutionStatus,
  type DesignFlowSessionView as SessionView,
} from "./model";
import {
  backspaceUrlText,
  closeHelp,
  deleteUrlText,
  enterDesignSelection,
  enterDestinationSelection,
  enterApprovalMode,
  enterUrlEntry,
  initialNavigationState,
  keepSelectionVisible,
  moveListSelection,
  moveUrlCursor,
  navigateBack,
  openOutput,
  openHelp,
  setOutputScrollOffset,
  toggleOutputDetails,
  setDestinationCandidates,
  setApprovalOption,
  setUrlError,
  updateUrlText,
  openProposalReview,
  openDiffView,
  closeDiffView,
  setDiffScrollOffset,
  moveReviewAction,
  moveReviewFile,
  type TuiNavigationState,
  type TuiReviewRequest,
} from "./navigation";
import { isCompactTerminal, mapTuiKey, reduceTuiInteraction, type TuiInteractionState } from "./keys";
import { Shell } from "./components";
import {
  applyExecutionProgress,
  applyExecutionReport,
  applyExecutionUpdate,
  applySessionResult,
  type TuiExecutionBridge,
} from "./execution";
import { buildArtifactViewerDocument, type ArtifactViewerDocument, type TuiArtifactReader } from "./artifact-viewer";
import type { VisualResultView } from "../../services/visual-result";
import { stripBracketedPasteMarkers } from "./url-window";

export type TuiAction =
  | { readonly type: "start"; readonly projectId?: string; readonly design: InteractiveDesign; readonly destination: DestinationCandidate; readonly approvalMode: "manual" | "designflow" }
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
  readonly artifactReader: TuiArtifactReader;
  readonly onAction: (action: TuiAction) => void;
  readonly onStart: (action: Extract<TuiAction, { readonly type: "start" }>, bridge: TuiExecutionBridge) => Promise<number>;
  readonly onInterrupt: () => void;
  readonly onImprove?: (bridge: TuiExecutionBridge) => Promise<number>;
}

export function App({
  session: initialSession,
  projectId,
  handlers,
  artifactReader,
  onAction,
  onStart,
  onInterrupt,
  onImprove,
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
    selectedOutput: 0,
  });
  const [viewerDocument, setViewerDocument] = useState<ArtifactViewerDocument | undefined>();
  const [executionStarted, setExecutionStarted] = useState(false);
  const [executionFinished, setExecutionFinished] = useState(false);
  const [visualResult, setVisualResult] = useState<VisualResultView | undefined>();
  const [prompt, setPrompt] = useState<{ readonly question: string; readonly options?: readonly string[]; readonly value: string }>();
  const promptResolver = useRef<((value: string) => void) | undefined>();
  const promptRejecter = useRef<(() => void) | undefined>();
  const reviewResolver = useRef<((value: "approve" | "reject") => void) | undefined>();
  const executionBridge = useRef<TuiExecutionBridge | undefined>();
  const cancellationRequested = useRef(false);
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

  useEffect(() => {
    setInteraction((current) => ({
      ...current,
      selectedOutput: Math.min(current.selectedOutput, Math.max(0, session.outputs.length - 1)),
    }));
  }, [session.outputs]);

  useEffect(() => {
    if (navigation.view !== "output-viewer" || navigation.outputId === undefined) {
      setViewerDocument(undefined);
      return;
    }
    const output = session.outputs.find((candidate) => candidate.id === navigation.outputId);
    if (output === undefined) {
      setViewerDocument(undefined);
      return;
    }
    let current = true;
    setViewerDocument(undefined);
    void artifactReader.read(output)
      .then((detail) => {
        if (current) setViewerDocument(buildArtifactViewerDocument(output, detail));
      })
      .catch(() => {
        if (current) setViewerDocument(buildArtifactViewerDocument(output, undefined));
      });
    return () => {
      current = false;
    };
  }, [artifactReader, navigation.outputId, navigation.view, session.outputs]);

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
    if (navigation.view === "visual-result") {
      if (visualResult?.reportAvailable) {
        const visual = session.outputs.find((output) => output.kind === "visual-validation");
        if (visual?.status === "available") setNavigation((current) => openOutput(current, visual.id));
      }
      return;
    }
    if (navigation.view === "proposal-review" || navigation.view === "correction-review") {
      if (navigation.reviewActionIndex === 0) {
        setNavigation((current) => openDiffView(current));
      } else if (navigation.reviewActionIndex === 1) {
        reviewResolver.current?.("approve");
        reviewResolver.current = undefined;
        setNavigation((current) => ({ ...current, view: "applying" }));
        setSession((current) => ({ ...current, activity: [{ actor: "designflow", title: "Applying changes…", state: "running" }] }));
      } else {
        reviewResolver.current?.("reject");
        reviewResolver.current = undefined;
        setNavigation((current) => ({ ...current, view: "final-result" }));
        setSession((current) => ({ ...current, finalResult: { status: "failure", summary: "Proposal rejected. No project files were changed." } }));
      }
      return;
    }
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
      setNavigation((current) => enterApprovalMode({ ...current, error: undefined }));
      return;
    }

    if (navigation.view === "approval-mode") {
      const mode = navigation.approvalOption === 1 ? "designflow" : "manual";
      setSession((current) => setApprovalMode(current, mode));
      setNavigation((current) => ({ ...current, view: "ready-to-run", error: undefined }));
      return;
    }

    if (navigation.view === "ready-to-run" && navigation.design !== undefined) {
      const destination = navigation.destinationCandidates[navigation.destinationIndex];
      if (destination === undefined || handoffStarted.current) return;
      handoffStarted.current = true;
      const action = { type: "start" as const, ...(projectId === undefined ? {} : { projectId }), design: navigation.design, destination, approvalMode: navigation.approvalMode };
      onAction(action);
      setExecutionStarted(true);
      setSession((current) => setExecutionStatus(current, "active", { actor: "designflow", title: "Starting Design Engineer", state: "running" }));
      setNavigation((current) => ({ ...current, view: "execution", error: undefined }));
      const bridge: TuiExecutionBridge = {
        update: (nextSession) => setSession(nextSession),
        progress: (progress) => setSession((current) => applyExecutionProgress(current, progress)),
        result: (result) => setSession((current) => applySessionResult(current, result)),
        report: (report) => setSession((current) => applyExecutionReport(current, report)),
        cancelled: () => {
          reviewResolver.current?.("reject");
          reviewResolver.current = undefined;
          promptRejecter.current?.();
          promptRejecter.current = undefined;
          promptResolver.current = undefined;
          setPrompt(undefined);
          setSession((current) => applyExecutionUpdate(current, { status: "cancelled" }));
        },
        ask: (question, options) => new Promise<string>((resolve, reject) => {
          promptResolver.current = resolve;
          promptRejecter.current = reject;
          setPrompt({ question, ...(options === undefined ? {} : { options }), value: "" });
        }),
        review: (request: TuiReviewRequest) => new Promise((resolve) => {
          reviewResolver.current = resolve;
          setNavigation((current) => openProposalReview(current, request));
        }),
        visual: (result: VisualResultView) => {
          setVisualResult(result);
          setNavigation((current) => ({ ...current, view: "visual-result" }));
        },
      };
      executionBridge.current = bridge;
      void onStart(action, bridge)
        .then(() => {
          setExecutionFinished(true);
          setNavigation((current) => current.view === "execution" ? { ...current, view: "final-result" } : current);
        })
        .catch((error: unknown) => {
          if (cancellationRequested.current) {
            setExecutionFinished(true);
            return;
          }
          setSession((current) => ({
            ...current,
            workflow: { ...current.workflow, status: "unavailable" },
            activity: [{ actor: "designflow", title: "Needs attention", detail: error instanceof Error ? error.message : "The workflow did not complete.", state: "failed" }],
            diagnostics: [error instanceof Error ? error.message : "The workflow did not complete."],
            finalResult: { status: "failure", summary: "The workflow did not complete." },
          }));
          setExecutionFinished(true);
          setNavigation((current) => ({ ...current, view: "final-result" }));
        });
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
    const text = stripBracketedPasteMarkers(input);
    if (text.length > 0 && key.ctrl !== true && key.meta !== true) {
      setNavigation((current) => updateUrlText(current, text));
    }
  };

  const compact = isCompactTerminal(size.columns, size.rows);
  const visibleCount = Math.max(1, size.rows - (compact ? 8 : 14));
  const viewerVisibleLines = Math.max(1, size.rows - (compact ? 8 : 10));
  const viewerMaximum = Math.max(0, (viewerDocument?.lines.length ?? 0) - viewerVisibleLines);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onInterrupt();
      if (!executionStarted || executionFinished) {
        onAction({ type: "quit" });
        exit();
      } else {
        cancellationRequested.current = true;
        executionBridge.current?.cancelled();
        setSession((current) => ({ ...current, activity: [{ actor: "designflow", title: "Cancelling…", state: "running" }] }));
      }
      return;
    }

    if (prompt !== undefined) {
      if (key.return || input === "\n" || input === "\r") {
        const answer = prompt.value.trim();
        if (answer.length === 0) return;
        promptResolver.current?.(answer);
        promptResolver.current = undefined;
        promptRejecter.current = undefined;
        setPrompt(undefined);
      } else if (key.backspace || input === "\b" || input === "\u007f") {
        setPrompt((current) => current === undefined ? current : { ...current, value: current.value.slice(0, -1) });
      } else if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
        setPrompt((current) => current === undefined ? current : { ...current, value: current.value + input });
      }
      return;
    }

    if (navigation.view === "output-viewer") {
      const outputAction = mapTuiKey(input, key);
      const home = input === "\u001b[H" || input === "\u001bOH";
      const end = input === "\u001b[F" || input === "\u001bOF";
      if (outputAction === "back") {
        setNavigation((current) => navigateBack(current));
      } else if (outputAction === "help") {
        setNavigation((current) => openHelp(current));
      } else if (outputAction === "next-focus" || outputAction === "previous-focus") {
        setInteraction((current) => reduceTuiInteraction(current, outputAction, session.workflow.stages.length));
      } else if (key.upArrow || input === "k") {
        setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset - 1, viewerMaximum));
      } else if (key.downArrow || input === "j") {
        setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset + 1, viewerMaximum));
      } else if (key.pageUp) {
        setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset - viewerVisibleLines, viewerMaximum));
      } else if (key.pageDown) {
        setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset + viewerVisibleLines, viewerMaximum));
      } else if (home) {
        setNavigation((current) => setOutputScrollOffset(current, 0, viewerMaximum));
      } else if (end) {
        setNavigation((current) => setOutputScrollOffset(current, viewerMaximum, viewerMaximum));
      } else if (input === "d") {
        setNavigation((current) => toggleOutputDetails(current));
      }
      if (outputAction === "quit" && (!executionStarted || executionFinished)) {
        onAction({ type: "quit" });
        exit();
      }
      return;
    }

    if (navigation.view === "diff-view") {
      const review = navigation.review?.review;
      const file = review?.files[navigation.reviewFileIndex];
      const maximum = Math.max(0, (file?.diff.length ?? 0) - viewerVisibleLines);
      const home = input === "\u001b[H" || input === "\u001bOH";
      const end = input === "\u001b[F" || input === "\u001bOF";
      const diffAction = mapTuiKey(input, key);
      if (diffAction === "back") setNavigation((current) => closeDiffView(current));
      else if (key.upArrow || input === "k") setNavigation((current) => setDiffScrollOffset(current, current.diffScrollOffset - 1, maximum));
      else if (key.downArrow || input === "j") setNavigation((current) => setDiffScrollOffset(current, current.diffScrollOffset + 1, maximum));
      else if (key.pageUp) setNavigation((current) => setDiffScrollOffset(current, current.diffScrollOffset - viewerVisibleLines, maximum));
      else if (key.pageDown) setNavigation((current) => setDiffScrollOffset(current, current.diffScrollOffset + viewerVisibleLines, maximum));
      else if (home) setNavigation((current) => setDiffScrollOffset(current, 0, maximum));
      else if (end) setNavigation((current) => setDiffScrollOffset(current, maximum, maximum));
      else if (input === "[") setNavigation((current) => moveReviewFile(current, -1));
      else if (input === "]") setNavigation((current) => moveReviewFile(current, 1));
      else if (diffAction === "help") setNavigation((current) => openHelp(current));
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

    if (navigation.view === "visual-result" && input.toLowerCase() === "i" && visualResult?.canImprove === true && onImprove !== undefined && executionBridge.current !== undefined) {
      setExecutionFinished(false);
      setNavigation((current) => ({ ...current, view: "execution" }));
      void onImprove(executionBridge.current)
        .then(() => {
          setExecutionFinished(true);
          setNavigation((current) => ({ ...current, view: "visual-result" }));
        })
        .catch((error: unknown) => {
          setExecutionFinished(true);
          setSession((current) => ({ ...current, diagnostics: [error instanceof Error ? error.message : "Improvement could not start."], finalResult: { status: "failure", summary: "Improvement could not start." } }));
          setNavigation((current) => ({ ...current, view: "final-result" }));
        });
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
      if (executionStarted && !executionFinished) return;
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
      else if (interaction.focusArea === "outputs") {
        const output = session.outputs[interaction.selectedOutput];
        if (output?.status === "available") setNavigation((current) => openOutput(current, output.id));
      }
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

    if ((navigation.view === "proposal-review" || navigation.view === "correction-review") && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      setNavigation((current) => moveReviewAction(current, action === "up" ? -1 : 1));
      return;
    }

    if (interaction.focusArea === "outputs" && (action === "up" || action === "down")) {
      setInteraction((current) => ({
        ...current,
        selectedOutput: Math.min(Math.max(0, current.selectedOutput + (action === "up" ? -1 : 1)), Math.max(0, session.outputs.length - 1)),
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

    if (navigation.view === "approval-mode" && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      setNavigation((current) => setApprovalOption(current, moveListSelection(current.approvalOption, 2, action === "up" ? -1 : 1)));
      return;
    }

    setInteraction((current) => reduceTuiInteraction(current, action, session.workflow.stages.length));
  });

  const selectedOutput = session.outputs[interaction.selectedOutput];

  return (
    <Shell
      session={session}
      navigation={navigation}
      helpOpen={navigation.view === "help"}
      focusArea={interaction.focusArea}
      selectedStage={interaction.selectedStage}
      selectedOutput={interaction.selectedOutput}
      compact={compact}
      destinationVisibleCount={visibleCount}
      viewerDocument={viewerDocument}
      viewerVisibleLines={viewerVisibleLines}
      selectedOutputView={selectedOutput}
      executionPrompt={prompt}
      visualResult={visualResult}
      terminalColumns={size.columns}
    />
  );
}
