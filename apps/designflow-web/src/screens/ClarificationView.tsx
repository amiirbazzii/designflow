// apps/designflow-web/src/screens/ClarificationView.tsx
import { useState } from "react";

/**
 * The clarification gate.
 *
 * Shown while an `AgentSession` is `waiting_for_user` — the agent asked a
 * question before deciding whether to run a workflow. The answer is handed
 * straight to `api.answerSession`; this component holds no session state of
 * its own, the same discipline `ApprovalView` already keeps toward the
 * runner's approval machinery.
 */
export function ClarificationView(props: {
  readonly question: string;
  readonly busy: boolean;
  readonly onSubmit: (answer: string) => void;
}): JSX.Element {
  const [answer, setAnswer] = useState("");

  const submit = (): void => {
    const trimmed = answer.trim();
    if (trimmed.length === 0) return;
    props.onSubmit(trimmed);
    setAnswer("");
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>One more thing</h2>
      <p>{props.question}</p>

      <label>
        <span>Your answer</span>
        <input
          value={answer}
          placeholder="Type your answer"
          disabled={props.busy}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </label>

      <div className="row">
        <button
          className="primary"
          disabled={props.busy || answer.trim().length === 0}
          onClick={submit}
        >
          {props.busy ? "Sending…" : "Send answer"}
        </button>
      </div>
    </div>
  );
}
