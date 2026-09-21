-- Fix ambiguity in desktop pairing RPC caused by RETURNS TABLE output names
-- colliding with unqualified ON CONFLICT column references.
-- Applied to production Supabase on 2026-09-21.

create or replace function public.desktop_pairing_consume(
  p_code text,
  p_secret_hash text,
  p_device_credential_hash text
)
returns table(device_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_pair private.desktop_pairing_sessions%rowtype;
  v_device_id uuid;
begin
  select *
  into v_pair
  from private.desktop_pairing_sessions
  where pairing_code = p_code
    and pairing_secret_hash = p_secret_hash
    and status = 'approved'
    and expires_at > now()
  for update;

  if not found then
    return;
  end if;

  insert into public.desktop_devices (
    workspace_id, registered_by, device_public_id, device_name,
    platform, architecture, app_version, public_key, status, last_seen_at
  )
  values (
    v_pair.workspace_id, v_pair.approved_by, v_pair.device_public_id, v_pair.device_name,
    v_pair.platform, v_pair.architecture, v_pair.app_version, v_pair.public_key, 'active', now()
  )
  on conflict on constraint desktop_devices_workspace_id_device_public_id_key
  do update set
    registered_by = excluded.registered_by,
    device_name = excluded.device_name,
    platform = excluded.platform,
    architecture = excluded.architecture,
    app_version = excluded.app_version,
    public_key = excluded.public_key,
    status = 'active',
    last_seen_at = now(),
    updated_at = now()
  returning id into v_device_id;

  insert into private.desktop_device_credentials(device_id, secret_hash, issued_at, revoked_at)
  values (v_device_id, p_device_credential_hash, now(), null)
  on conflict on constraint desktop_device_credentials_pkey
  do update set
    secret_hash = excluded.secret_hash,
    issued_at = now(),
    rotated_at = now(),
    revoked_at = null;

  update private.desktop_pairing_sessions
  set status = 'consumed',
      consumed_at = now()
  where id = v_pair.id;

  insert into public.desktop_license_audit(
    workspace_id, device_id, event_type, app_version, billing_status, metadata
  )
  select v_pair.workspace_id, v_device_id, 'pair_consumed', v_pair.app_version, w.billing_status,
         jsonb_build_object('platform', v_pair.platform, 'architecture', v_pair.architecture)
  from public.workspaces w
  where w.id = v_pair.workspace_id;

  device_id := v_device_id;
  workspace_id := v_pair.workspace_id;
  return next;
end;
$function$;
