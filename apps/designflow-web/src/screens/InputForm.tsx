// apps/designflow-web/src/screens/InputForm.tsx
import { useState } from "react";
import type { WorkflowSummary } from "../api-client";

/**
 * The workflow input form.
 *
 * Generated from the workflow's own field descriptors, not hardcoded per
 * workflow. Installing a second workflow adds a screen without changing one:
 * the fields, their placeholders and their choices all travel with the
 * workflow.
 *
 * The descriptors live here for now because `WorkflowManifest` has no field
 * metadata yet — see the ADR's limitations.
 */

interface Field {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly list?: boolean;
  readonly choices?: readonly string[];
}

const FIELDS: Record<string, readonly Field[]> = {
  "design-to-code": [
    { key: "designFile", label: "Design file", placeholder: "homepage.fig" },
    {
      key: "framework",
      label: "Framework",
      placeholder: "react",
      choices: ["react", "vue", "svelte"],
    },
    {
      key: "frames",
      label: "Frames",
      placeholder: "brand/Header, brand/Footer, layout/Dashboard",
      list: true,
    },
  ],
};

export function InputForm(props: {
  readonly workflow: WorkflowSummary;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (input: Record<string, unknown>) => void;
}): JSX.Element {
  const fields = FIELDS[props.workflow.workflowId] ?? [];
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
