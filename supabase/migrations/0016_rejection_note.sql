-- ====================================================================
-- 0016: rejection note — the admin can explain WHY a piece was rejected
-- ====================================================================
-- The owner can now type a short note when rejecting a pending community
-- piece. It travels two channels to the seller:
--   1. the in-app bell notification body (appended as "Reason: …")
--   2. the listing-decision email (via notify_listing_decision_email → the
--      /api/notifications/email webhook payload, which now carries `note`)
-- A blank note behaves exactly like the old flow, so quick rejections still
-- work with zero extra clicks.
--
-- SAFE TO RE-RUN: the old signatures are dropped first so CREATE OR REPLACE
-- installs the note-aware versions (Postgres would otherwise keep both
-- overloads and the bare-name grants below would hit 42725).

drop function if exists public.admin_delete_product(uuid);
drop function if exists public.notify_listing_decision_email(uuid, text, text);

-- Fire the seller-notification email webhook (pg_net → the app's
-- /api/notifications/email route). No-op when pg_net or the webhook
-- settings are missing, so moderation never breaks because of email. The
-- webhook URL + secret live in app_settings and must match
-- EMAIL_WEBHOOK_SECRET in the app's .env.local.
create or replace function public.notify_listing_decision_email(
  p_seller_id  uuid,
  p_item_title text,
  p_status     text,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url     text;
  v_secret  text;
  v_headers jsonb;
begin
  if p_seller_id is null or p_item_title is null or p_item_title = '' then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select value into v_url    from public.app_settings where key = 'email_webhook_url';
  select value into v_secret from public.app_settings where key = 'email_webhook_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return; -- webhook not configured yet
  end if;

  v_headers := jsonb_build_object(
    'Content-Type',     'application/json',
    'x-webhook-secret', v_secret
  );

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
      'sellerId',  p_seller_id::text,
      'itemTitle', p_item_title,
      'status',    p_status,
      'note',      coalesce(p_note, '')
    ),
    headers := v_headers
  );
end;
$$;

-- Admin-only product removal (dashboard). Blocks non-admins. When the piece
-- is a pending community listing, the seller gets a rejection notification
-- (in-app bell + email webhook) BEFORE the row is deleted — with the admin's
-- optional `p_note` as the reason.
create or replace function public.admin_delete_product(
  p_product_id uuid,
  p_note       text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_title     text;
  v_note      text; -- capped copy of p_note used for the insert + email
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  -- The UI caps the note at 300 chars; this belt-and-braces cap protects the
  -- notification body + webhook payload from an oversized direct RPC call.
  v_note := left(coalesce(p_note, ''), 500);

  -- Notify the seller when their pending community piece is rejected
  -- (before the row is deleted): in-app bell + email webhook.
  select seller_id, title into v_seller_id, v_title
  from public.products
  where id = p_product_id
    and source = 'community'
    and status = 'pending'
    and seller_id is not null;

  if v_seller_id is not null then
    insert into public.notifications (user_id, type, title, body)
    values (
      v_seller_id,
      'listing_rejected',
      'Piece not approved',
      'Your "' || v_title || '" was not approved.'
        || case
             when v_note = '' then ' You can re-list it with better photos.'
             else ' Reason: ' || v_note
           end
    );
    perform public.notify_listing_decision_email(v_seller_id, v_title, 'rejected', v_note);
  end if;

  delete from public.products where id = p_product_id;
end;
$$;

revoke all on function public.admin_delete_product from public;
grant execute on function public.admin_delete_product to authenticated;
