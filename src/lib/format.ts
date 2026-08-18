export function formatKes(amount: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Serialize a JSON-LD object for safe embedding in a <script> tag via
 * dangerouslySetInnerHTML. Escapes </script> sequences that JSON.stringify
 * does not handle, preventing XSS if any string value contains that
 * substring.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\/?script/gi, (m) =>
    m.replace(/</g, "\u003c")
  );
}
