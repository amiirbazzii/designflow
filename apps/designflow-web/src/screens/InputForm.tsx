// apps/designflow-web/src/screens/InputForm.tsx
import { useState } from "react";
import type { WorkerSummary } from "../api-client";

/**
 * The worker input form.
 *
 * Generated from `props.workflow.inputs` — the worker's own
 * `WorkerManifest.inputs`, forwarded by the API (`GET /workers`) — never
 * hardcoded per worker here. Installing a fifth worker adds a working form
 * with no change to this file, closing the gap an earlier version of this
 * component had: a workflow this table did not name got an empty form.
 *
 * The prop is still named `workflow` for the value it carries — a worker's
 * own input fields — even though its type is now `WorkerSummary`: the Worker
 * Task Boundary is the only entry point into a run.
 */

export function InputForm(props: {
  readonly workflow: WorkerSummary;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (input: Record<string, unknown>) => void;
}): JSX.Element {
  const fields = props.workflow.inputs;
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = (): void => {
    const input: Record<string, unknown> = {};

    for (const field of fields) {
      // A blank field takes its placeholder, so a first-time reader can press
      // Start and get a working run.
      const raw = (values[field.key] ?? "").trim() || field.placeholder;

      input[field.key] =
        field.list === true
          ? raw.split(",").map((part) => part.trim()).filter(Boolean)
          : raw;
    }

    props.onSubmit(input);
  };

  return (
    <>
      <h2>{props.workflow.name}</h2>
      <p className="meta">{props.workflow.description}</p>

      <div className="card">
        {fields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            {field.choices !== undefined ? (
              <select
                value={values[field.key] ?? field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              >
                {field.choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              />
            )}
          </label>
        ))}

        <div className="row">
          <button className="primary" disabled={props.busy} onClick={submit}>
            {props.busy ? "Starting…" : "Start workflow"}
          </button>
          <button disabled={props.busy} onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
