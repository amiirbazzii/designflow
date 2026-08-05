import { describe, expect, test } from "bun:test";
import {
  figmaSpecificationResponseSchema,
  implementationResponseSchema,
  visualCorrectionResponseSchema,
  visualValidationReportResponseSchema,
  visualValidationResponseSchema,
} from "./model-response-schemas";

const specializedSchemas = {
  figmaSpecificationResponseSchema,
  implementationResponseSchema,
  visualValidationResponseSchema,
  visualValidationReportResponseSchema,
  visualCorrectionResponseSchema,
} as const;

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const node = value as Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}

describe("specialized provider response schemas", () => {
  for (const [name, schema] of Object.entries(specializedSchemas)) {
    test(`${name} avoids unsupported OpenRouter strict-schema constructs`, () => {
      const unsupported: string[] = [];
      walk(schema, (node) => {
        for (const keyword of ["oneOf", "anyOf", "allOf", "const"]) {
          if (keyword in node) unsupported.push(keyword);
        }
      });

      expect(unsupported).toEqual([]);
    });

    test(`${name} closes every object vocabulary`, () => {
      const violations: string[] = [];
      walk(schema, (node) => {
        const properties = node["properties"];
        if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return;

        if (node["additionalProperties"] !== false) violations.push("additionalProperties");
        const propertyNames = Object.keys(properties);
        const required = Array.isArray(node["required"]) ? node["required"] : [];
        for (const propertyName of propertyNames) {
          if (!required.includes(propertyName)) violations.push(`required:${propertyName}`);
        }
      });

      expect(violations).toEqual([]);
    });
  }
});
