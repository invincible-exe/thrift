export default function SupabaseBanner() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  if (configured) return null;

  return (
    <div className="border-b border-accent/30 bg-accent-soft px-4 py-2.5 text-center text-xs font-semibold text-ink">
      <span className="font-black uppercase tracking-widest">Preview mode:</span> add your
      Supabase keys to{" "}
      <code className="rounded bg-paper px-1.5 py-0.5 font-mono">.env.local</code> (see README) to
      enable accounts, live checkout, and the P2P marketplace.
    </div>
  );
}
