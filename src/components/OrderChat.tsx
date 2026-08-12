"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { sendOrderMessage, useOrderMessages } from "@/lib/db";
import { formatDate } from "@/lib/format";

/**
 * Private buyer↔seller chat thread for one order. Access is enforced in the
 * DB (RLS: only the order's buyer, the linked listing's seller, or an admin
 * can read/insert) — this component just renders and sends.
 *
 * `isSeller` only affects the labels shown for the other party ("Buyer" vs
 * "Seller"); the messages themselves are keyed by sender_id.
 */
export default function OrderChat({
  orderId,
  isSeller = false,
}: {
  orderId: string;
  isSeller?: boolean;
}) {
  const { user } = useAuth();
  const messages = useOrderMessages(orderId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const ordered = [...(messages ?? [])].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ordered.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !user || sending) return;
    setSending(true);
    setError("");
    try {
      await sendOrderMessage(orderId, body);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the message.");
    } finally {
      setSending(false);
    }
  };

  const otherLabel = isSeller ? "Buyer" : "Seller";

  return (
    <div className="rounded-2xl border border-line bg-sand/40 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
        Meetup chat: agree on a public spot and a time
      </p>
      <div ref={scrollRef} className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {messages !== null && ordered.length === 0 && (
          <p className="rounded-xl bg-paper px-3 py-2 text-xs text-ink-soft">
            No messages yet. Say hi, pick a public meeting point, and set a time.
          </p>
        )}
        {ordered.map((m) => {
          const mine = m.senderId === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? "bg-ink text-cream" : "border border-line bg-paper"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? "text-cream/60" : "text-ink-soft"}`}>
                  {mine ? "You" : otherLabel} · {formatDate(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isSeller ? "Message the buyer…" : "Message the seller…"}
          disabled={!user}
          className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none transition focus:border-ink disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!draft.trim() || !user || sending}
          className="shrink-0 rounded-xl bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wider text-cream transition hover:bg-accent disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {error && <p className="mt-1.5 text-xs text-accent">{error}</p>}
    </div>
  );
}
