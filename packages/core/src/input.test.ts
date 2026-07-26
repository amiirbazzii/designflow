import { describe, expect, test } from "bun:test";
import { resolveNodeInput } from "./input";

describe("resolveNodeInput", () => {
  test("passes a plain inputMap through untouched", () => {
    expect(resolveNodeInput({ a: 1, b: "x" }, { seed: 9 })).toEqual({
      a: 1,
      b: "x",
    });
  });

  test("a whole-map reference resolves to the entire workflow input", () => {
    expect(
      resolveNodeInput({ $workflowInput: true }, { message: "hi" }),
    ).toEqual({ message: "hi" });
  });

  test("a whole-map selector resolves to one property", () => {
    expect(
      resolveNodeInput({ $workflowInput: "message" }, { message: "hi" }),
    ).toBe("hi");
  });

  test("per-value references resolve alongside literals", () => {
    expect(
      resolveNodeInput(
        {
          greeting: { $workflowInput: "message" },
          all: { $workflowInput: true },
          literal: 42,
        },
        { message: "hi", extra: true },
      ),
    ).toEqual({
      greeting: "hi",
      all: { message: "hi", extra: true },
      literal: 42,
    });
  });

  test("a selector against a non-object input yields undefined", () => {
    expect(resolveNodeInput({ $workflowInput: "message" }, "plain")).toBeUndefined();
    expect(resolveNodeInput({ $workflowInput: "message" }, undefined)).toBeUndefined();
  });

  test("a missing property yields undefined", () => {
    expect(
      resolveNodeInput({ $workflowInput: "absent" }, { message: "hi" }),
    ).toBeUndefined();
  });

  test("an object that merely resembles a reference is not resolved", () => {
    const inputMap = { $workflowInput: true, other: 1 };
    expect(resolveNodeInput(inputMap, { seed: 1 })).toEqual({
      $workflowInput: true,
      other: 1,
    });
  });

  test("an empty inputMap stays empty regardless of workflow input", () => {
    expect(resolveNodeInput({}, { seed: 1 })).toEqual({});
  });

  test("falsy workflow input values are preserved", () => {
    expect(resolveNodeInput({ v: { $workflowInput: "n" } }, { n: 0 })).toEqual({
      v: 0,
    });
    expect(resolveNodeInput({ $workflowInput: true }, false)).toBe(false);
  });
});
