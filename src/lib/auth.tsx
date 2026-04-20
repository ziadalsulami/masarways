/**
 * MASAR — Authentication context.
 *
 * Wraps the app and exposes the current Supabase session, the matching
 * MASAR profile (full_name, masar_id, email, phone, ...) and the user's
 * role ("admin" or "passenger"). Components read from useAuth() to know
 * who is signed in and to gate UI.
 *
 * Important: the onAuthStateChange listener is registered BEFORE the
 * initial getSession() call — this is the recommended Supabase pattern
 * to avoid missing auth events that fire during boot.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Shape of a row in our public.profiles table (kept loose on purpose).
export interface MasarProfile {
  id: string;
  masar_id: string;       // e.g. "A0001" or "P0007"
  full_name: string;
  email: string;
  phone: string;
  national_id: string | null;
}

export type AppRole = "admin" | "passenger";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: MasarProfile | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch profile + role from the database (e.g. after signup). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MasarProfile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Loads the profile + role for a given user id. Kept as a separate
   * function so we can re-call it after signup or on demand.
   */
  const loadProfile = async (userId: string) => {
    // Profile and role live in two different tables — fetch both in parallel.
    const [{ data: prof }, { data: roleRow }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    ]);
    setProfile((prof as MasarProfile) ?? null);
    setRole((roleRow?.role as AppRole) ?? null);
  };

  useEffect(() => {
    // 1) Subscribe FIRST so we don't miss any auth event during boot.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        // Defer the supabase call to the next tick to avoid recursive
        // updates from inside the listener.
        setTimeout(() => loadProfile(newSession.user.id), 0);
      } else {
        setProfile(null);
        setRole(null);
      }
    });

    // 2) Then read the existing session (if any) on first mount.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, role, loading, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Convenience hook used everywhere instead of useContext directly. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
