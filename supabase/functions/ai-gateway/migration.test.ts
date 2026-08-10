import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("../../migrations/20260810140000_designflow_ai_usage.sql", import.meta.url)), "utf8");

describe("ai usage migration", () => {
  test("contains only operational identity, route, status, reservation and usage fields", () => {
    expect(migration).toContain("create table if not exists public.designflow_ai_usage");
    for (const field of ["request_id", "user_id", "profile_id", "effective_model", "status", "created_at", "completed_at", "reservation_expires_at", "input_tokens", "output_tokens", "total_tokens", "reserved_cost_usd", "actual_cost_usd"]) {
      expect(migration).toContain(field);
    }
    expect(migration.toLowerCase()).not.toContain("prompt");
    expect(migration.toLowerCase()).not.toContain("jwt");
    expect(migration.toLowerCase()).not.toContain("secret");
  });

  test("uses atomic, expiring reservations and conservative success finalization", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("reservation_expires_at <= v_now");
    expect(migration).toContain("p_actual_cost_usd, reserved_cost_usd");
    expect(migration).toContain("designflow_reserve_ai_usage");
    expect(migration).toContain("designflow_finalize_ai_usage");
  });

  test("locks down the table and privileged RPCs", () => {
    expect(migration.trimStart().startsWith("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("alter table public.designflow_ai_usage enable row level security");
    expect(migration).toMatch(/revoke all on table public\.designflow_ai_usage from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/revoke all on function public\.designflow_reserve_ai_usage[\s\S]*from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.designflow_reserve_ai_usage[\s\S]*to service_role/);
    expect(migration).toMatch(/security definer[\s\S]*set search_path = pg_catalog, public/);
  });
});
