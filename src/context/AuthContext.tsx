"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  checkOAuthProviderEnabled,
  getBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

/**
 * Normalized app user — Supabase's User has metadata nested in
 * `user_metadata`, so we flatten the fields the UI actually uses.
 */
export interface AppUser {
  id: string;
  email: string | null;
  name: string;
  photoUrl: string | null;
}

interface AuthContextValue {
  user: AppUser | null;
  initializing: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Returns true when a session was established, false when email confirmation is required. */
  signUpWithEmail: (name: string, email: string, password: string) => Promise<boolean>;
  resendConfirmationEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Update the user's display name in auth metadata and profiles table. */
  updateUserName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toAppUser(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AppUser {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    name: String(meta.name ?? meta.full_name ?? u.email ?? ""),
    photoUrl: (meta.avatar_url as string | undefined) ?? null,
  };
}

/**
 * Base origin for auth callback links. Email confirmation links get clicked
 * later — often on a different device — so a "localhost" origin baked in at
 * sign-up time breaks there (the phone tries to reach ITS own localhost).
 * NEXT_PUBLIC_SITE_URL (set to a public URL like the ngrok tunnel) makes the
 * link reachable from anywhere; without it, the current tab's origin is used.
 */
function authCallbackBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
}

async function upsertUserProfile(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const client = getBrowserClient();
  if (!client) return;
  const meta = u.user_metadata ?? {};
  const name = String(meta.name ?? meta.full_name ?? u.email ?? "");
  try {
    await client.from("profiles").upsert(
      {
        id: u.id,
        name,
        email: u.email ?? null,
        photo_url: (meta.avatar_url as string | undefined) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch (err) {
    // Best-effort sync — a missing/blocked profiles table (migration not run
    // yet) must never break an otherwise successful sign-in or sign-up.
    console.warn("Profile sync skipped:", (err as Error)?.message ?? err);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  // Not configuring Supabase is a synchronous, known state — no effect needed.
  const [initializing, setInitializing] = useState(() => !isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let mounted = true;

    client.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setUser(toAppUser(data.session.user));
        void upsertUserProfile(data.session.user);
      }
      setInitializing(false);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(toAppUser(session.user));
        void upsertUserProfile(session.user);
      } else {
        setUser(null);
      }
      setInitializing(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
    // The hosted authorize page hard-fails with a raw JSON error when the
    // provider is disabled — check first and fail with a friendly message.
    const googleEnabled = await checkOAuthProviderEnabled("google");
    if (googleEnabled === false) {
      throw new Error("GOOGLE_NOT_ENABLED");
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/`,
      },
    });
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const client = getBrowserClient();
    if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      const client = getBrowserClient();
      if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${authCallbackBase()}/auth/callback?next=/`,
        },
      });
      if (error) throw error;
      // When email confirmation is enabled, no session comes back — the
      // caller should show the "check your inbox" state.
      if (data.session) {
        await upsertUserProfile(data.session.user);
        return true;
      }
      return false;
    },
    []
  );

  /** Re-send the sign-up confirmation email with the canonical callback URL,
   *  so a link that was baked with a stale origin (e.g. localhost) can be
   *  replaced by one that works from any device. */
  const resendConfirmationEmail = useCallback(async (email: string) => {
    const client = getBrowserClient();
    if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${authCallbackBase()}/auth/callback?next=/` },
    });
    if (error) throw error;
  }, []);

  const logout = useCallback(async () => {
    const client = getBrowserClient();
    if (client) await client.auth.signOut();
  }, []);

  const updateUserName = useCallback(async (name: string) => {
    const client = getBrowserClient();
    if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
    // Update auth metadata (source of truth for user.name).
    const { error: metaErr } = await client.auth.updateUser({
      data: { name },
    });
    if (metaErr) throw metaErr;
    // Sync to the profiles table.
    const { data: { user: updated } } = await client.auth.getUser();
    if (updated) {
      setUser(toAppUser(updated));
      void upsertUserProfile(updated);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        resendConfirmationEmail,
        logout,
        updateUserName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
