import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="text-5xl">🔐</span>
      <h1 className="mt-4 font-display text-3xl font-black tracking-tight">
        Sign-in link expired
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        That link was used already or expired. Try signing in again from the
        store, it takes a minute.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-full bg-accent px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep"
      >
        Back to the drops
      </Link>
    </section>
  );
}
