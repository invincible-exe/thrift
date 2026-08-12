import Link from "next/link";

/**
 * 404 — mostly hit when a 1-of-1 piece sells (its row is deleted) after a
 * link was shared or crawled. Say so plainly instead of a dead-end error.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="text-6xl">💨</span>
      <h1 className="mt-5 font-display text-3xl font-black tracking-tight sm:text-4xl">
        This drop is gone
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
        1-of-1 pieces sell fast. The piece behind this link was already
        claimed. Fresh drops land weekly, and they go just as quickly.
      </p>
      <Link
        href="/#drops"
        className="mt-8 rounded-full bg-accent px-8 py-3.5 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-accent-deep"
      >
        See what&apos;s live now
      </Link>
    </main>
  );
}
