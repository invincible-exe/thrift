"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { sendListingMessage, useListingMessages } from "@/lib/db";
import { formatDate } from "@/lib/format";

/**
 * Private buyer↔uploader thread for one listing — the pre-purchase chat
 * ("still available?", "does it fit?"). Access is enforced in the DB
 * (RLS: only the conversation's buyer, the piece's seller, or an admin
 * can read/insert) — this component just renders and sends.
 *
 * Visually identical to OrderChat so the pre- and post-purchase threads
 * feel like one product; only the table + header copy differ.
 */
export default function ListingChat({
  conversationId,
  otherLabel = "Seller",
  header = "Ask before you buy — fit, condition, meetup spot",
}: {
  conversationId: string;
  otherLabel?: string;
  header?: string;
}) {
  const { user } = useAuth();
  const messages = useListingMessages(conversationId);
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
      await sendListingMessage(conversationId, body);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-sand/40 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
        {header}
      </p>
      <div ref={scrollRef} className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {messages !== null && ordered.length === 0 && (
          <p className="rounded-xl bg-paper px-3 py-2 text-xs text-ink-soft">
            No messages yet. Say hi — ask about fit, condition, or where to meet.
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
          maxLength={2000}
          placeholder={`Message the ${otherLabel.toLowerCase()}…`}
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
