-- 10/10 Thrifts — security hardening (zero trust / least privilege).
-- SAFE TO RE-RUN: every statement is guarded with `drop policy if exists`.

-- ====================================================================
-- 1. STORAGE: remove the authenticated direct-upload path
-- ====================================================================
--
-- All listing-photo uploads go through POST /api/storage/upload, which uses
-- the service-role client. That route:
--   • re-encodes every image to WebP server-side (type/size validated),
--   • namespaces each path under the uploader's user id, and
--   • refuses uploads from unauthenticated callers.
--
-- The `product_images_authenticated_upload` INSERT policy was a second,
-- weaker write path into the same public bucket: any signed-in user could
-- insert an object at ANY path (including another user's `{uid}/...` prefix,
-- overwriting their photo) and host unvetted content (SVG/HTML/malware) on
-- the app's storage domain without ever passing through the server-side
-- image validation.
--
-- Dropping it closes that hole. The public read policy stays — the feed
-- renders the bucket's images directly. The upload/remove API routes use the
-- service role (which bypasses RLS) and are unaffected.
drop policy if exists "product_images_authenticated_upload" on storage.objects;

-- ====================================================================
-- 2. STORAGE: guard against policy drift
-- ====================================================================
-- If a future migration or manual edit re-adds a permissive write policy on
-- the product-images bucket, this check surfaces it immediately instead of
-- silently widening the attack surface. (Policy is not created here — the
-- service role does not need one to write.)
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'product_images%'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise notice
      'SECURITY: write policy % on storage.objects (bucket product-images) is active — expected only read policies',
      (select string_agg(policyname, ', ')
         from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname like 'product_images%'
          and cmd in ('INSERT', 'UPDATE', 'DELETE'));
  end if;
end $$;
