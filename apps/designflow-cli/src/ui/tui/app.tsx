import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdin, useStdout } from "ink";
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
  moveUrlCursorEnd,
  moveUrlCursorHome,
  navigateBack,
  openOutput,
  openHelp,
  setOutputScrollOffset,
  toggleOutputDetails,
  setDestinationCandidates,
  setApprovalOption,
  setUrlError,
  setFreshReady,
  setFreshEvidenceLoading,
  setFreshEvidence,
  setFreshScaffoldLoading,
  setFreshScaffold,
  setFreshGenerationLoading,
  setFreshGeneration,
  updateUrlText,
  openProposalReview,
  openDiffView,
  closeDiffView,
  setDiffScrollOffset,
  moveReviewAction,
  moveReviewFile,
  moveOutcomeAction,
  openDiagnosticsView,
  openNeedsAttention,
  openSignInRequired,
  openSigningIn,
  setAuthBrowserFallback,
  type TuiNavigationState,
  type TuiReviewRequest,
} from "./navigation";
import {
  isBackspaceInput,
  isCompactTerminal,
  isEndInput,
  isForwardDeleteInput,
  isHomeInput,
  mapTuiKey,
  reduceTuiInteraction,
  type TuiInteractionState,
} from "./keys";
import {
  backspaceText,
  deleteForwardText,
  insertText,
  moveTextCursor,
  moveTextCursorEnd,
  moveTextCursorHome,
  type TextEditorState,
  type TuiPromptState,
} from "./text-input";
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
import {
  latestAvailableOutput,
  terminalOutcomeActionForShortcut,
  terminalOutcomeActions,
  terminalOutcomeFromSession,
  terminalOutcomeMenuActions,
  type TerminalOutcomeActionId,
  type TerminalOutcomeKind,
  type TerminalOutcomeView,
} from "./outcome";
import { canStartDesignEngineer, requiresInteractiveAuthentication, type TuiAuthController } from "./auth";
import { appendFileSync } from "node:fs";
import { readyFreshUiState } from "./fresh-ui";
import type { FreshFrameEvidence } from "../../services/fresh-figma-evidence";
import type { FreshScaffoldResult } from "../../services/fresh-project-scaffolder";
import type { FreshGenerationResult } from "../../services/fresh-ui-generation";

export type TuiMode = "legacy" | "fresh";

// TEMPORARY diagnostics for the Phase 6B input-lifecycle investigation.
// Active only when DESIGNFLOW_TUI_TRACE names a file; removed before release.
function trace(event: string, fields: Record<string, unknown>): void {
  const target = process.env["DESIGNFLOW_TUI_TRACE"];
  if (target === undefined || target.length === 0) return;
  try {
    appendFileSync(target, `${JSON.stringify({ t: Date.now(), event, ...fields })}\n`);
  } catch {
    // diagnostics never break the app
  }
}

/**
 * Views whose navigation the TUI owns outright. While one of these is on
 * screen, a legacy bridge question has no rendered surface, so it must never
 * be allowed to capture keys — it is answered with its default instead.
 */
const TUI_OWNED_VIEWS: ReadonlySet<string> = new Set([
  "proposal-review",
  "correction-review",
  "diff-view",
  "output-viewer",
  "visual-result",
  "needs-attention",
  "final-result",
  "validation-result",
  "diagnostics-view",
  "applying",
]);

export type TuiAction =
  | { readonly type: "start"; readonly projectId?: string; readonly design: InteractiveDesign; readonly destination: DestinationCandidate; readonly approvalMode: "manual" | "designflow" }
  | { readonly type: "quit" };

export interface TuiSelectionHandlers {
  readonly getCurrentDesign: () => Promise<InteractiveDesign | null>;
  readonly parseFigmaUrl: (value: string) => InteractiveDesign;
  readonly getDestinations?: () => Promise<readonly DestinationCandidate[]>;
  readonly getFreshEvidence?: (
    ready: Extract<ReturnType<typeof readyFreshUiState>, { readonly status: "ready-to-generate" }>,
  ) => Promise<FreshFrameEvidence>;
  readonly scaffoldFreshProject?: (evidence: FreshFrameEvidence) => Promise<FreshScaffoldResult>;
  readonly generateFreshProject?: (evidence: FreshFrameEvidence, scaffold: FreshScaffoldResult) => Promise<FreshGenerationResult>;
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
  readonly auth?: TuiAuthController;
  readonly mode?: TuiMode;
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
  auth,
  mode = "legacy",
}: TuiAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { internal_eventEmitter } = useStdin();
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  const [session, setSession] = useState<SessionView>(initialSession);
  const [navigation, setNavigation] = useState<TuiNavigationState>(() => {
    const initial = initialNavigationState();
    if (mode === "fresh") return { ...initial, view: "design-selection" };
    return (auth !== undefined && requiresInteractiveAuthentication(auth.status()))
      || (auth === undefined && initialSession.ai.status === "pending" && initialSession.ai.label === "Sign-in required")
      ? openSignInRequired(initial)
      : initial;
  });
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
  const [prompt, setPrompt] = useState<TuiPromptState>();
  const promptResolver = useRef<((value: string) => void) | undefined>();
  const promptRejecter = useRef<(() => void) | undefined>();
  const reviewResolver = useRef<((value: "approve" | "reject") => void) | undefined>();
  const executionBridge = useRef<TuiExecutionBridge | undefined>();
  const executionDoneRef = useRef(false);
  const cancellationRequested = useRef(false);
  const destinationRequest = useRef(0);
  const freshEvidenceRequest = useRef(0);
  const handoffStarted = useRef(false);
  const rawInputRef = useRef<string | undefined>();
  const authRequestRef = useRef(0);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  const navigateBackFromUi = (): void => {
    freshEvidenceRequest.current += 1;
    setNavigation((current) => navigateBack(current));
  };

  // One input owner: a pending ask() may only capture keys while the
  // execution view renders it. Once the run is over, any pending or late
  // question is answered with its default ("" — callers treat empty as
  // decline/save-and-stop) so the interactive terminal outcome keeps input.
  const resolvePendingPrompt = (): void => {
    const resolve = promptResolver.current;
    promptResolver.current = undefined;
    promptRejecter.current = undefined;
    if (resolve !== undefined) {
      trace("prompt-flushed", {});
      resolve("");
    }
    setPrompt(undefined);
  };

  const finishExecution = (): void => {
    executionDoneRef.current = true;
    setExecutionFinished(true);
    resolvePendingPrompt();
  };

  const authenticationRequired = (): boolean =>
    auth !== undefined
      ? requiresInteractiveAuthentication(auth.status())
      : session.ai.status === "pending" && session.ai.label === "Sign-in required";

  const beginSignIn = (): void => {
    if (auth === undefined || navigation.view === "signing-in") return;
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    setNavigation((current) => openSigningIn(current));
    void auth.signInWithGoogle((url) => {
      if (authRequestRef.current !== requestId) return;
      setNavigation((current) => setAuthBrowserFallback(current, url));
    })
      .then((status) => {
        if (authRequestRef.current !== requestId) return;
        if (requiresInteractiveAuthentication(status)) {
          setNavigation((current) => openSignInRequired(current, "Sign-in is required to start Design Engineer."));
          return;
        }
        setSession((current) => ({
          ...current,
          ai: {
            status: status === "not-configured" ? "not-configured" : "ready",
            label: status === "development-provider" ? "Development provider" : "Connected",
          },
          activity: [{ actor: "designflow", title: "Signed in", state: "completed" }],
        }));
        setNavigation((current) => ({ ...current, view: "start", authError: undefined, authBrowserFallback: undefined }));
      })
      .catch((error: unknown) => {
        if (authRequestRef.current !== requestId) return;
        setNavigation((current) => openSignInRequired(
          current,
          error instanceof Error ? error.message : "Sign-in could not be completed.",
        ));
      });
  };

  useEffect(() => {
    const rememberRawInput = (chunk: unknown): void => {
      rawInputRef.current = String(chunk);
    };
    internal_eventEmitter?.on("input", rememberRawInput);
    return () => {
      internal_eventEmitter?.off("input", rememberRawInput);
    };
  }, [internal_eventEmitter]);

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

  useEffect(() => {
    // A terminal failure can arrive before the final report/cleanup promise
    // settles. Once the TUI knows execution ended, it must leave the execution
    // input lock even if the last workflow-status callback was incomplete.
    if (navigation.view !== "execution" || (!executionFinished && session.workflow.status !== "unavailable")) return;
    setNavigation((current) => {
      if (current.view !== "execution") return current;
      return session.finalResult?.status === "success"
        ? { ...current, view: "final-result", outcomeActionIndex: 0 }
        : openNeedsAttention(current);
    });
  }, [executionFinished, navigation.view, session.finalResult?.status, session.workflow.status]);

  const loadDestinations = (design: InteractiveDesign): void => {
    if (handlers.getDestinations === undefined) return;
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
    if (mode === "fresh") {
      try {
        const ready = readyFreshUiState(design);
        setSession((current) => setDesignSelection(current, design));
        setNavigation((current) => setFreshReady(current, ready));
        if (handlers.getFreshEvidence !== undefined) {
          const requestId = freshEvidenceRequest.current + 1;
          freshEvidenceRequest.current = requestId;
          setNavigation((current) => setFreshEvidenceLoading(current));
          void handlers.getFreshEvidence(ready)
            .then((evidence) => {
              if (freshEvidenceRequest.current !== requestId) return;
              if (handlers.scaffoldFreshProject === undefined) {
                setNavigation((current) => current.view === "ready-to-generate"
                  ? setFreshEvidence(current, evidence)
                  : current);
                return;
              }
              setNavigation((current) => current.view === "ready-to-generate"
                ? setFreshScaffoldLoading(setFreshEvidence(current, evidence))
                : current);
              void handlers.scaffoldFreshProject(evidence)
                .then((project) => {
                  if (freshEvidenceRequest.current !== requestId) return;
                  setNavigation((current) => current.view === "ready-to-generate"
                    ? setFreshScaffold(current, evidence, project)
                    : current);
                  if (handlers.generateFreshProject !== undefined) {
                    setNavigation((current) => current.view === "ready-to-generate"
                      ? setFreshGenerationLoading(current)
                      : current);
                    void handlers.generateFreshProject(evidence, project)
                      .then((generation) => {
                        if (freshEvidenceRequest.current !== requestId) return;
                        setNavigation((current) => current.view === "ready-to-generate"
                          ? setFreshGeneration(current, generation)
                          : current);
                      })
                      .catch((error: unknown) => {
                        if (freshEvidenceRequest.current !== requestId) return;
                        setNavigation((current) => current.view === "ready-to-generate"
                          ? { ...current, loading: null, error: error instanceof Error ? error.message : "Fresh UI generation failed." }
                          : current);
                      });
                  }
                })
                .catch((error: unknown) => {
                  if (freshEvidenceRequest.current !== requestId) return;
                  setNavigation((current) => current.view === "ready-to-generate"
                    ? {
                        ...setFreshEvidence(current, evidence),
                        error: error instanceof Error ? error.message : "Fresh project could not be created.",
                      }
                    : current);
                });
            })
            .catch((error: unknown) => {
              if (freshEvidenceRequest.current !== requestId) return;
              setNavigation((current) => current.view === "ready-to-generate"
                ? {
                    ...current,
                    loading: null,
                    error: error instanceof Error ? error.message : "Figma evidence could not be retrieved.",
                  }
                : current);
            });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid Figma source.";
        setNavigation((current) => ({ ...current, loading: null, error: message }));
      }
      return;
    }
    setSession((current) => setDesignSelection(current, design));
    loadDestinations(design);
  };

  const activate = (): void => {
    if (navigation.view === "sign-in-required") {
      beginSignIn();
      return;
    }
    if (navigation.view === "signing-in") return;
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
      if (mode === "fresh") {
        setNavigation((current) => enterDesignSelection(current));
        return;
      }
      if (authenticationRequired()) {
        setNavigation((current) => openSignInRequired(current));
        return;
      }
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

    if (navigation.view === "ready-to-generate") return;

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
      if (auth !== undefined && !canStartDesignEngineer(auth.status())) {
        setNavigation((current) => openSignInRequired(current, "Sign in again before starting Design Engineer."));
        return;
      }
      const destination = navigation.destinationCandidates[navigation.destinationIndex];
      if (destination === undefined || handoffStarted.current) return;
      handoffStarted.current = true;
      const action = { type: "start" as const, ...(projectId === undefined ? {} : { projectId }), design: navigation.design, destination, approvalMode: navigation.approvalMode };
      onAction(action);
      executionDoneRef.current = false;
      setExecutionStarted(true);
      setExecutionFinished(false);
      setSession((current) => setExecutionStatus(current, "active", { actor: "designflow", title: "Starting Design Engineer", state: "running" }));
      setNavigation((current) => ({ ...current, view: "execution", error: undefined }));
      const bridge: TuiExecutionBridge = {
        update: (nextSession) => setSession(nextSession),
        progress: (progress) => setSession((current) => applyExecutionProgress(current, progress)),
        result: (result) => {
          if (result.session.status === "failed" || result.session.status === "declined" || result.session.status === "cancelled") {
            finishExecution();
          }
          setSession((current) => applySessionResult(current, result));
        },
        report: (report) => {
          const root = typeof report === "object" && report !== null
            ? report as { readonly overview?: { readonly state?: unknown; readonly status?: unknown } }
            : undefined;
          if (root?.overview?.state === "failed" || root?.overview?.status === "cancelled") {
            finishExecution();
          }
          setSession((current) => applyExecutionReport(current, report));
        },
        cancelled: () => {
          reviewResolver.current?.("reject");
          reviewResolver.current = undefined;
          promptRejecter.current?.();
          promptRejecter.current = undefined;
          promptResolver.current = undefined;
          setPrompt(undefined);
          finishExecution();
          setSession((current) => applyExecutionUpdate(current, { status: "cancelled" }));
        },
        ask: (question, options) => new Promise<string>((resolve, reject) => {
          trace("bridge-ask", { question, options, done: executionDoneRef.current });
          // A question that arrives after the run already reached a terminal
          // outcome — or while a TUI-owned interactive view is on screen —
          // has no place to render. Answering with the default ("" — callers
          // treat empty as decline / no) keeps exactly one input owner.
          if (executionDoneRef.current || TUI_OWNED_VIEWS.has(navigationRef.current.view)) {
            resolve("");
            return;
          }
          promptResolver.current = resolve;
          promptRejecter.current = reject;
          setPrompt({ question, ...(options === undefined ? {} : { options }), value: "", cursorIndex: 0, viewportStart: 0, optionIndex: 0 });
        }),
        review: (request: TuiReviewRequest) => new Promise((resolve) => {
          reviewResolver.current = resolve;
          // The review owns input from the moment it appears: any lingering
          // sidebar focus would silently divert Enter to the outputs list.
          setInteraction((current) => ({ ...current, focusArea: "main" }));
          setNavigation((current) => openProposalReview(current, request));
        }),
        visual: (result: VisualResultView) => {
          setVisualResult(result);
          setInteraction((current) => ({ ...current, focusArea: "main" }));
          setNavigation((current) => ({ ...current, view: "visual-result", outcomeActionIndex: 0 }));
        },
        authRequired: (message) => {
          finishExecution();
          setSession((current) => ({
            ...current,
            ai: { status: "pending", label: "Sign-in required" },
            workflow: { ...current.workflow, status: "unavailable" },
            diagnostics: [message ?? "Sign in again to continue."],
          }));
          setNavigation((current) => openSignInRequired(current, message));
        },
      };
      executionBridge.current = bridge;
      void onStart(action, bridge)
        .then(() => {
          finishExecution();
        })
        .catch((error: unknown) => {
          if (cancellationRequested.current) {
            finishExecution();
            return;
          }
          setSession((current) => ({
            ...current,
            workflow: { ...current.workflow, status: "unavailable" },
            activity: [{ actor: "designflow", title: "Needs attention", detail: error instanceof Error ? error.message : "The workflow did not complete.", state: "failed" }],
            diagnostics: [error instanceof Error ? error.message : "The workflow did not complete."],
            finalResult: { status: "failure", summary: "The workflow did not complete." },
          }));
          finishExecution();
          setNavigation((current) => openNeedsAttention(current));
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
  const executionBusy = executionStarted && !executionFinished && navigation.view === "execution" && session.workflow.status === "active" && session.finalResult === undefined;
  const isTerminalOutcomeView = navigation.view === "needs-attention" || navigation.view === "final-result" || navigation.view === "validation-result" || (navigation.view === "execution" && !executionBusy && (executionFinished || session.workflow.status === "unavailable"));
  const terminalOutcomeKind: TerminalOutcomeKind = session.finalResult?.status === "success"
    ? "completed"
    : session.finalResult?.summary.startsWith("Cancelled") === true
      ? "cancelled"
      : "needs-attention";
  const terminalOutcome: TerminalOutcomeView | undefined = isTerminalOutcomeView
    ? terminalOutcomeFromSession(session, terminalOutcomeKind)
    : undefined;

  const activateTerminalOutcome = (actionId: TerminalOutcomeActionId): void => {
    if (actionId === "view-report") {
      const output = latestAvailableOutput(session.outputs);
      if (output !== undefined) setNavigation((current) => openOutput(current, output.id));
    } else if (actionId === "view-details") {
      setNavigation((current) => openDiagnosticsView(current));
    } else if (actionId === "outputs") {
      setInteraction((current) => ({ ...current, focusArea: "outputs" }));
    } else if (actionId === "back-to-start") {
      // Returning to start ends the previous run's lifecycle entirely so the
      // next journey can start a fresh execution.
      handoffStarted.current = false;
      cancellationRequested.current = false;
      executionDoneRef.current = false;
      resolvePendingPrompt();
      setExecutionStarted(false);
      setExecutionFinished(false);
      setInteraction((current) => ({ ...current, focusArea: "main", selectedStage: 0, selectedOutput: 0 }));
      setSession(({ finalResult: _previousResult, ...current }) => ({
        ...current,
        workflow: { ...current.workflow, status: "idle" },
        diagnostics: [],
        technicalDetails: [],
      }));
      setNavigation((current) => ({ ...current, view: "start", outcomeActionIndex: 0 }));
    } else if (actionId === "quit") {
      onAction({ type: "quit" });
      exit();
    }
  };

  useInput((input, key) => {
    const rawInput = rawInputRef.current;
    rawInputRef.current = undefined;
    trace("useInput", {
      input: JSON.stringify(input),
      raw: JSON.stringify(rawInput),
      view: navigation.view,
      focusArea: interaction.focusArea,
      prompt: prompt !== undefined,
      executionBusy,
      isTerminalOutcomeView,
      outcomeActionIndex: navigation.outcomeActionIndex,
      executionFinished,
      workflowStatus: session.workflow.status,
      finalResult: session.finalResult?.status,
    });
    if (key.ctrl && input === "c") {
      onInterrupt();
      if (!executionBusy) {
        onAction({ type: "quit" });
        exit();
      } else {
        cancellationRequested.current = true;
        executionBridge.current?.cancelled();
        setSession((current) => ({ ...current, activity: [{ actor: "designflow", title: "Cancelling…", state: "running" }] }));
      }
      return;
    }

    if (prompt !== undefined && navigation.view !== "execution") {
      // Invariant: a prompt may only capture input while it is rendered
      // (execution view). Anything else is a desynced legacy question —
      // self-heal by answering its default and handle this key normally.
      trace("prompt-desync", { view: navigation.view });
      resolvePendingPrompt();
    } else if (prompt !== undefined) {
      if (prompt.options !== undefined) {
        if (key.upArrow || rawInput === "\u001b[A") {
          setPrompt((current) => current === undefined ? current : { ...current, optionIndex: Math.max(0, current.optionIndex - 1) });
        } else if (key.downArrow || rawInput === "\u001b[B") {
          setPrompt((current) => current === undefined ? current : { ...current, optionIndex: Math.min(current.options!.length - 1, current.optionIndex + 1) });
        } else if (key.return || input === "\n" || input === "\r") {
          const answer = prompt.options[prompt.optionIndex];
          if (answer === undefined) return;
          promptResolver.current?.(answer);
          promptResolver.current = undefined;
          promptRejecter.current = undefined;
          setPrompt(undefined);
        }
        return;
      }
      if (key.return || input === "\n" || input === "\r") {
        const answer = prompt.value.trim();
        if (answer.length === 0) return;
        promptResolver.current?.(answer);
        promptResolver.current = undefined;
        promptRejecter.current = undefined;
        setPrompt(undefined);
      } else if (isBackspaceInput(input, key, rawInput)) {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, backspaceText(current)));
      } else if (isForwardDeleteInput(input, key, rawInput)) {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, deleteForwardText(current)));
      } else if (isHomeInput(input, rawInput)) {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, moveTextCursorHome(current)));
      } else if (isEndInput(input, rawInput)) {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, moveTextCursorEnd(current)));
      } else if (key.leftArrow || rawInput === "\u001b[D") {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, moveTextCursor(current, -1)));
      } else if (key.rightArrow || rawInput === "\u001b[C") {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, moveTextCursor(current, 1)));
      } else if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
        setPrompt((current) => current === undefined ? current : applyPromptEditor(current, insertText(current, input)));
      }
      return;
    }

    if (navigation.view === "output-viewer") {
      const outputAction = mapTuiKey(input, key);
      const home = input === "\u001b[H" || input === "\u001bOH";
      const end = input === "\u001b[F" || input === "\u001bOF";
      if (outputAction === "back") {
        navigateBackFromUi();
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
      if (outputAction === "quit" && !executionBusy) {
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

    if (navigation.view === "diagnostics-view") {
      const detailsAction = mapTuiKey(input, key);
      const detailLines = session.technicalDetails.length > 0 ? session.technicalDetails : session.diagnostics;
      const detailsMaximum = Math.max(0, detailLines.length - viewerVisibleLines);
      if (detailsAction === "back") navigateBackFromUi();
      else if (key.upArrow || input === "k") setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset - 1, detailsMaximum));
      else if (key.downArrow || input === "j") setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset + 1, detailsMaximum));
      else if (key.pageUp) setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset - viewerVisibleLines, detailsMaximum));
      else if (key.pageDown) setNavigation((current) => setOutputScrollOffset(current, current.outputScrollOffset + viewerVisibleLines, detailsMaximum));
      else if (detailsAction === "help") setNavigation((current) => openHelp(current));
      else if (detailsAction === "quit") {
        onAction({ type: "quit" });
        exit();
      }
      return;
    }

    if (navigation.view === "figma-url-entry") {
      if (key.escape) {
        navigateBackFromUi();
      } else if (key.return || input === "\n" || input === "\r") {
        activate();
      } else if (isBackspaceInput(input, key, rawInput)) {
        setNavigation((current) => backspaceUrlText(current));
      } else if (isForwardDeleteInput(input, key, rawInput)) {
        setNavigation((current) => deleteUrlText(current));
      } else if (isHomeInput(input, rawInput)) {
        setNavigation((current) => moveUrlCursorHome(current));
      } else if (isEndInput(input, rawInput)) {
        setNavigation((current) => moveUrlCursorEnd(current));
      } else {
        handleUrlInput(input, key);
      }
      return;
    }

    const beginImprove = (): void => {
      if (visualResult?.canImprove !== true || onImprove === undefined || executionBridge.current === undefined) return;
      executionDoneRef.current = false;
      setExecutionFinished(false);
      setNavigation((current) => ({ ...current, view: "execution" }));
      void onImprove(executionBridge.current)
        .then(() => {
          finishExecution();
          setNavigation((current) => ({ ...current, view: "visual-result", outcomeActionIndex: 0 }));
        })
        .catch((error: unknown) => {
          finishExecution();
          setSession((current) => ({ ...current, diagnostics: [error instanceof Error ? error.message : "Improvement could not start."], finalResult: { status: "failure", summary: "Improvement could not start." } }));
          setNavigation((current) => ({ ...current, view: "final-result" }));
        });
    };

    if (navigation.view === "visual-result" && input.toLowerCase() === "i" && visualResult?.canImprove === true) {
      beginImprove();
      return;
    }

    const action = mapTuiKey(input, key);

    // Visual Result owns its action navigation (§ DF-TUI-09): arrows/j-k move
    // the selection, Enter activates it, Tab must not divert focus.
    if (navigation.view === "visual-result") {
      const visualActions = visualResult?.actions ?? [];
      if ((action === "up" || action === "down") && visualActions.length > 0) {
        setNavigation((current) => moveOutcomeAction(current, action === "up" ? -1 : 1, visualActions.length));
        return;
      }
      if (action === "next-focus" || action === "previous-focus") return;
      if (action === "activate") {
        const selected = visualActions[navigation.outcomeActionIndex] ?? "Finish";
        if (selected === "View report") {
          const visual = session.outputs.find((output) => output.kind === "visual-validation");
          if (visual?.status === "available") setNavigation((current) => openOutput(current, visual.id));
        } else if (selected === "Improve") {
          beginImprove();
        } else {
          setSession((current) => current.finalResult === undefined
            ? { ...current, finalResult: { status: "success", summary: "Finished. Your approved changes remain in place." } }
            : current);
          setNavigation((current) => ({ ...current, view: "final-result", outcomeActionIndex: 0 }));
        }
        return;
      }
    }

    // Proposal/correction review owns its input outright (§ DF-TUI-08): the
    // advertised keys act on the review regardless of any lingering sidebar
    // focus, `d` opens the diff as the status bar promises, and Tab must not
    // silently divert Enter to the outputs list.
    if (navigation.view === "proposal-review" || navigation.view === "correction-review") {
      if (input === "d") {
        setNavigation((current) => openDiffView(current));
        return;
      }
      if (action === "next-focus" || action === "previous-focus") return;
      if (action === "up" || action === "down") {
        setNavigation((current) => moveReviewAction(current, action === "up" ? -1 : 1));
        return;
      }
      if (action === "activate") {
        if (interaction.focusArea !== "main") setInteraction((current) => ({ ...current, focusArea: "main" }));
        activate();
        return;
      }
    }
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
      if (isTerminalOutcomeView) {
        const quit = terminalOutcomeActionForShortcut(terminalOutcome?.actions ?? [], "quit");
        if (quit !== undefined) activateTerminalOutcome(quit.id);
      } else if (!executionBusy) {
        onAction({ type: "quit" });
        exit();
      }
      return;
    }
    if (action === "back") {
      if (isTerminalOutcomeView) {
        const back = terminalOutcomeActionForShortcut(terminalOutcome?.actions ?? [], "back");
        if (back !== undefined) activateTerminalOutcome(back.id);
      } else {
        navigateBackFromUi();
      }
      return;
    }
    if (action === "activate") {
      if (isTerminalOutcomeView && interaction.focusArea === "main") {
        const actions = terminalOutcomeMenuActions(terminalOutcome?.actions ?? terminalOutcomeActions(false, false));
        const selected = actions[navigation.outcomeActionIndex];
        trace("outcome-activate", { menuCount: actions.length, index: navigation.outcomeActionIndex, selected: selected?.id });
        if (selected !== undefined) activateTerminalOutcome(selected.id);
      } else if (interaction.focusArea === "main") activate();
      else if (interaction.focusArea === "outputs") {
        const output = session.outputs[interaction.selectedOutput];
        if (output?.status === "available") setNavigation((current) => openOutput(current, output.id));
      }
      return;
    }
    if (action === "next-focus" || action === "previous-focus") {
      if (isTerminalOutcomeView && action === "next-focus" && terminalOutcomeActionForShortcut(terminalOutcome?.actions ?? [], "tab") !== undefined && interaction.focusArea === "main") {
        activateTerminalOutcome("outputs");
      } else {
        setInteraction((current) => reduceTuiInteraction(current, action, session.workflow.stages.length));
      }
      return;
    }

    if (isTerminalOutcomeView && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      const count = terminalOutcomeMenuActions(terminalOutcome?.actions ?? []).length;
      setNavigation((current) => moveOutcomeAction(current, action === "up" ? -1 : 1, count));
      return;
    }

    if (navigation.view === "design-selection" && interaction.focusArea === "main" && (action === "up" || action === "down")) {
      setNavigation((current) => ({
        ...current,
        designOption: moveListSelection(current.designOption, 2, action === "up" ? -1 : 1),
      }));
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
      executionBusy={executionBusy}
      terminalOutcome={terminalOutcome}
      freshMode={mode === "fresh"}
    />
  );
}

function applyPromptEditor(prompt: TuiPromptState, editor: TextEditorState): TuiPromptState {
  return { ...prompt, value: editor.value, cursorIndex: editor.cursorIndex, viewportStart: editor.viewportStart };
}
