begin;

create table if not exists public.designflow_ai_usage (
  request_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  effective_model text not null,
  status text not null check (status in ('reserved', 'succeeded', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reservation_expires_at timestamptz not null,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  reserved_cost_usd numeric(12, 8) not null check (reserved_cost_usd >= 0),
  actual_cost_usd numeric(12, 8) check (actual_cost_usd is null or actual_cost_usd >= 0)
);

create index if not exists designflow_ai_usage_user_created_idx
  on public.designflow_ai_usage (user_id, created_at, status);

create index if not exists designflow_ai_usage_created_status_idx
  on public.designflow_ai_usage (created_at, status);

alter table public.designflow_ai_usage enable row level security;
revoke all on table public.designflow_ai_usage from public, anon, authenticated, service_role;

create or replace function public.designflow_reserve_ai_usage(
  p_request_id text,
  p_user_id uuid,
  p_profile_id text,
  p_effective_model text,
  p_reserved_cost_usd numeric,
  p_reserved_tokens bigint,
  p_requests_per_minute integer,
  p_requests_per_day integer,
  p_requests_per_month integer,
  p_tokens_per_day bigint,
  p_tokens_per_month bigint,
  p_cost_usd_per_day numeric,
  p_cost_usd_per_month numeric,
  p_global_cost_usd_per_day numeric,
  p_global_cost_usd_per_month numeric,
  p_reservation_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute_requests bigint;
  v_day_requests bigint;
  v_month_requests bigint;
  v_day_tokens numeric;
  v_month_tokens numeric;
  v_day_cost numeric;
  v_month_cost numeric;
  v_global_day_cost numeric;
  v_global_month_cost numeric;
begin
  if p_request_id is null or length(p_request_id) = 0 or length(p_request_id) > 200
    or p_user_id is null or p_profile_id is null or length(p_profile_id) = 0 or length(p_profile_id) > 160
    or p_effective_model is null or length(p_effective_model) = 0 or length(p_effective_model) > 240
    or p_reserved_cost_usd is null or p_reserved_cost_usd < 0
    or p_reserved_tokens is null or p_reserved_tokens < 0
    or p_reservation_ttl_seconds is null or p_reservation_ttl_seconds < 1 then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_SERVICE_UNAVAILABLE', 'message', 'usage protection configuration is invalid');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('designflow_ai_usage', 0));

  update public.designflow_ai_usage
  set status = 'expired', completed_at = v_now
  where status = 'reserved' and reservation_expires_at <= v_now;

  select count(*) into v_minute_requests
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= v_now - interval '1 minute';
  if v_minute_requests + 1 > p_requests_per_minute then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_RATE_LIMIT', 'message', 'the DesignFlow request rate limit was reached', 'retry_after_seconds', 60);
  end if;

  select count(*) into v_day_requests
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('day', v_now);
  if v_day_requests + 1 > p_requests_per_day then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow request quota was reached', 'retry_after_seconds', 86400);
  end if;

  select count(*) into v_month_requests
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('month', v_now);
  if v_month_requests + 1 > p_requests_per_month then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow request quota was reached', 'retry_after_seconds', 86400);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_tokens else coalesce(total_tokens, 0) end), 0) into v_day_tokens
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('day', v_now);
  if v_day_tokens + p_reserved_tokens > p_tokens_per_day then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow token quota was reached', 'retry_after_seconds', 86400);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_tokens else coalesce(total_tokens, 0) end), 0) into v_month_tokens
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('month', v_now);
  if v_month_tokens + p_reserved_tokens > p_tokens_per_month then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow token quota was reached', 'retry_after_seconds', 86400);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_cost_usd else coalesce(actual_cost_usd, 0) end), 0) into v_day_cost
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('day', v_now);
  if v_day_cost + p_reserved_cost_usd > p_cost_usd_per_day then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow AI cost quota was reached', 'retry_after_seconds', 86400);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_cost_usd else coalesce(actual_cost_usd, 0) end), 0) into v_month_cost
  from public.designflow_ai_usage
  where user_id = p_user_id and status in ('reserved', 'succeeded', 'failed')
    and created_at >= date_trunc('month', v_now);
  if v_month_cost + p_reserved_cost_usd > p_cost_usd_per_month then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_QUOTA_EXCEEDED', 'message', 'the DesignFlow AI cost quota was reached', 'retry_after_seconds', 86400);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_cost_usd else coalesce(actual_cost_usd, 0) end), 0) into v_global_day_cost
  from public.designflow_ai_usage
  where status in ('reserved', 'succeeded', 'failed') and created_at >= date_trunc('day', v_now);
  if v_global_day_cost + p_reserved_cost_usd > p_global_cost_usd_per_day then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_SERVICE_UNAVAILABLE', 'message', 'managed AI service protection is active', 'retry_after_seconds', 3600);
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_cost_usd else coalesce(actual_cost_usd, 0) end), 0) into v_global_month_cost
  from public.designflow_ai_usage
  where status in ('reserved', 'succeeded', 'failed') and created_at >= date_trunc('month', v_now);
  if v_global_month_cost + p_reserved_cost_usd > p_global_cost_usd_per_month then
    return jsonb_build_object('allowed', false, 'code', 'ERR_MODEL_SERVICE_UNAVAILABLE', 'message', 'managed AI service protection is active', 'retry_after_seconds', 3600);
  end if;

  insert into public.designflow_ai_usage (
    request_id, user_id, profile_id, effective_model, status,
    reservation_expires_at, reserved_tokens, reserved_cost_usd
  ) values (
    p_request_id, p_user_id, p_profile_id, p_effective_model, 'reserved',
    v_now + make_interval(secs => p_reservation_ttl_seconds), p_reserved_tokens, p_reserved_cost_usd
  );

  return jsonb_build_object('allowed', true, 'reservation_id', p_request_id);
end;
$$;

create or replace function public.designflow_finalize_ai_usage(
  p_request_id text,
  p_status text,
  p_input_tokens bigint default null,
  p_output_tokens bigint default null,
  p_total_tokens bigint default null,
  p_actual_cost_usd numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated boolean;
  v_row_count integer;
begin
  if p_status not in ('succeeded', 'failed') then
    return jsonb_build_object('ok', false);
  end if;

  update public.designflow_ai_usage
  set status = p_status,
      completed_at = clock_timestamp(),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      actual_cost_usd = case when p_status = 'succeeded' then coalesce(p_actual_cost_usd, reserved_cost_usd) else p_actual_cost_usd end,
      reserved_tokens = case when p_status = 'succeeded' and p_total_tokens is null then reserved_tokens else 0 end
  where request_id = p_request_id and status = 'reserved';

  get diagnostics v_row_count = row_count;
  v_updated := v_row_count > 0;
  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.designflow_reserve_ai_usage(text, uuid, text, text, numeric, bigint, integer, integer, integer, bigint, bigint, numeric, numeric, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function public.designflow_finalize_ai_usage(text, text, bigint, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.designflow_reserve_ai_usage(text, uuid, text, text, numeric, bigint, integer, integer, integer, bigint, bigint, numeric, numeric, numeric, numeric, integer) to service_role;
grant execute on function public.designflow_finalize_ai_usage(text, text, bigint, bigint, bigint, numeric) to service_role;

commit;
