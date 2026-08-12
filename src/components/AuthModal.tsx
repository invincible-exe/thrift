"use client";

import { useState, type FormEvent } from "react";
import Modal from "./ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useShop } from "@/context/ShopContext";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import styles from "./ui/AuthForm.module.css";

type Tab = "signin" | "signup";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  "Invalid login credentials": "Incorrect email or password.",
    email_exists: "An account with this email already exists. Try signing in.",
  "User already registered": "An account with this email already exists. Try signing in.",
  weak_password: "Password is too weak. Use 8+ characters with an uppercase letter, a number and a symbol.",
  "Password should be at least 6 characters.": "Password is too weak. Use 8+ characters with an uppercase letter, a number and a symbol.",
  email_not_confirmed: "Please confirm your email first. Check your inbox for the confirmation link.",
  "Email not confirmed": "Please confirm your email first. Check your inbox for the confirmation link.",
  popup_blocked: "The sign-in window was blocked. Allow popups and try again.",
  SUPABASE_NOT_CONFIGURED: "Supabase isn't configured yet. Add your keys to .env.local.",
  GOOGLE_NOT_ENABLED: "Google sign-in isn't switched on yet. Enable it in the Supabase dashboard (Authentication → Sign In / Providers → Google).",
  "Unsupported provider: provider is not enabled": "Google sign-in isn't switched on yet. Enable it in the Supabase dashboard (Authentication → Sign In / Providers → Google).",
  "Email signups are disabled": "Email sign-ups are switched off in the Supabase dashboard. Enable them under Authentication → Sign In / Providers → Email.",
  database_error: "Account created, but the profiles table is missing. Run the migration (supabase/migrations/0001_init.sql), then try again.",
  "Database error saving new user": "Account created, but the profiles table is missing. Run the migration (supabase/migrations/0001_init.sql), then try again.",
};

export default function AuthModal() {
  const { authOpen, closeAuth, completeAuth } = useShop();
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, resendConfirmationEmail } = useAuth();

  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resent, setResent] = useState(false);

  // Strong-password rules for sign-up — no weak passwords on this store.
  const PASSWORD_RULES = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Lowercase letter", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /\d/.test(password) },
    { label: "Symbol", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const passwordStrong = PASSWORD_RULES.every((r) => r.ok);

  // A stale confirmation link (baked with localhost, say) breaks on other
  // devices — resend with the canonical callback URL instead.
  const handleResend = async () => {
    if (resendBusy || !confirmEmail) return;
    setResendBusy(true);
    setError("");
    setResent(false);
    try {
      await resendConfirmationEmail(confirmEmail);
      setResent(true);
    } catch (err) {
      setError(resolveErrorMessage(err));
    } finally {
      setResendBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // OAuth navigates away — the pending action is restored on return.
      await signInWithGoogle();
    } catch (e) {
      setError(resolveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (tab === "signin") {
        await signInWithEmail(email, password);
        completeAuth();
      } else {
        if (!passwordStrong) {
          setError("Password is too weak. Tick every requirement below.");
          return;
        }
        if (password !== confirm) {
          setError("Passwords don't match.");
          return;
        }
        const sessionCreated = await signUpWithEmail(name, email, password);
        if (sessionCreated) {
          completeAuth();
        } else {
          setConfirmEmail(email);
        }
      }
    } catch (err) {
      setError(resolveErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  function resolveErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      const code = (err as { code?: string }).code ?? err.message;
      const msg = ERROR_MESSAGES[code];
      if (msg) return msg;
      // Keep a breadcrumb so unknown auth failures are easy to debug.
      console.error("Unmapped auth error:", err);
    }
    return "Something went wrong. Try again.";
  }

  return (
    <Modal open={authOpen} onClose={closeAuth} label="Sign in to 10/10 Thrifts">
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-sm font-black tracking-tight">10/10 THRIFTS</span>
          <button
            onClick={closeAuth}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:bg-sand hover:text-ink"
          >
            ✕
          </button>
        </div>

        {confirmEmail ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="text-5xl">📬</span>
            <h3 className="mt-4 font-display text-2xl font-black">Check your inbox</h3>
            <p className="mt-2 max-w-xs text-sm text-ink-soft">
              We sent a confirmation link to{" "}
              <span className="font-bold text-ink">{confirmEmail}</span>. Click it to
              activate your account, then sign in. If the link points at
              localhost (it won&apos;t open on this device), resend it below.
            </p>
            {error && <p className={`${styles.error} mt-4`}>{error}</p>}
            <div className="mt-6 flex flex-col items-center gap-3">
              {resent ? (
                <p className="rounded-full bg-lime/20 px-4 py-2 text-sm font-bold text-ink">
                  Sent again. Check your inbox
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resendBusy}
                  className="rounded-full border border-line px-6 py-3 text-sm font-bold text-ink-soft transition hover:border-ink hover:text-ink disabled:opacity-50"
                >
                  {resendBusy ? "Sending…" : "Resend confirmation link"}
                </button>
              )}
              <button
                onClick={() => {
                  setConfirmEmail(null);
                  setTab("signin");
                }}
                className="rounded-full bg-ink px-6 py-3 text-sm font-bold text-cream transition hover:bg-black"
              >
                I&apos;ve confirmed. Sign in
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-full border border-line bg-sand p-1">
              {(["signin", "signup"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setError("");
                  }}
                  className={`rounded-full py-2 text-sm font-bold transition ${
                    tab === t ? "bg-ink text-cream shadow" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {t === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            {!isSupabaseConfigured && (
              <div className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm text-ink">
                <p className="font-bold">Supabase not connected yet</p>
                <p className="mt-1 text-ink-soft">
                  Add your Supabase URL + anon key to{" "}
                  <code className="rounded bg-paper px-1">.env.local</code> (see README)
                  and restart the dev server to enable accounts.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.title}>
                {tab === "signin" ? (
                  <>
                    Welcome back,
                    <br />
                    <span>sign in to continue</span>
                  </>
                ) : (
                  <>
                    Welcome,
                    <br />
                    <span>sign up to continue</span>
                  </>
                )}
              </div>

              {tab === "signup" && (
                <input
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Full name"
                  autoComplete="name"
                  aria-label="Full name"
                  disabled={busy}
                />
              )}
              <input
                className={styles.input}
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Email"
                autoComplete="email"
                aria-label="Email"
                disabled={busy}
              />
              <input
                className={styles.input}
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={tab === "signup" ? 8 : undefined}
                placeholder="Password"
                autoComplete={tab === "signin" ? "current-password" : "new-password"}
                aria-label="Password"
                disabled={busy}
              />

              {tab === "signup" && (
                <>
                  <div className={styles.rules}>
                    <p className={styles.rulesTitle}>Password requirements</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {PASSWORD_RULES.map((rule) => (
                        <span
                          key={rule.label}
                          className={`${styles.rule} ${rule.ok ? styles.ruleOk : ""}`}
                        >
                          <span
                            className={`${styles.ruleDot} ${
                              rule.ok ? styles.ruleDotOk : styles.ruleDotNot
                            }`}
                          >
                            {rule.ok ? "✓" : ""}
                          </span>
                          {rule.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <input
                    className={styles.input}
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    aria-label="Confirm password"
                    disabled={busy}
                  />
                </>
              )}

              <div className={styles.loginWith}>
                <button
                  type="button"
                  className={styles.buttonLog}
                  aria-label="Continue with Google"
                  title="Continue with Google"
                  onClick={handleGoogle}
                  disabled={busy}
                >
                  <svg
                    className={styles.icon}
                    xmlnsXlink="http://www.w3.org/1999/xlink"
                    xmlns="http://www.w3.org/2000/svg"
                    xmlSpace="preserve"
                    width="56.6934px"
                    viewBox="0 0 56.6934 56.6934"
                    version="1.1"
                    height="56.6934px"
                  >
                    <path d="M51.981,24.4812c-7.7173-0.0038-15.4346-0.0019-23.1518-0.001c0.001,3.2009-0.0038,6.4018,0.0019,9.6017  c4.4693-0.001,8.9386-0.0019,13.407,0c-0.5179,3.0673-2.3408,5.8723-4.9258,7.5991c-1.625,1.0926-3.492,1.8018-5.4168,2.139  c-1.9372,0.3306-3.9389,0.3729-5.8713-0.0183c-1.9651-0.3921-3.8409-1.2108-5.4773-2.3649  c-2.6166-1.8383-4.6135-4.5279-5.6388-7.5549c-1.0484-3.0788-1.0561-6.5046,0.0048-9.5805  c0.7361-2.1679,1.9613-4.1705,3.5708-5.8002c1.9853-2.0324,4.5664-3.4853,7.3473-4.0811c2.3812-0.5083,4.8921-0.4113,7.2234,0.294  c1.9815,0.6016,3.8082,1.6874,5.3044,3.1163c1.5125-1.5039,3.0173-3.0164,4.527-4.5231c0.7918-0.811,1.624-1.5865,2.3908-2.4196  c-2.2928-2.1218-4.9805-3.8274-7.9172-4.9056C32.0723,4.0363,26.1097,3.995,20.7871,5.8372  C14.7889,7.8907,9.6815,12.3763,6.8497,18.0459c-0.9859,1.9536-1.7057,4.0388-2.1381,6.1836  C3.6238,29.5732,4.382,35.2707,6.8468,40.1378c1.6019,3.1768,3.8985,6.001,6.6843,8.215c2.6282,2.0958,5.6916,3.6439,8.9396,4.5078c4.0984,1.0993,8.461,1.0743,12.5864,0.1355c3.7284-0.8581,7.256-2.6397,10.0725-5.24c2.977-2.7358,5.1006-6.3403,6.2249-10.2138  C52.5807,33.3171,52.7498,28.8064,51.981,24.4812z" />
                  </svg>
                </button>
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button type="submit" disabled={busy} className={styles.buttonConfirm}>
                {busy ? (
                  <span className="mx-auto h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
                ) : (
                  "Let's go →"
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-xs leading-relaxed text-ink-soft">
              By continuing you agree to the 10/10 Thrifts terms. Pieces are 1-of-1.
              First payment wins the fit.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
