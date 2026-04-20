/**
 * MASAR landing page = combined Login / Sign-up screen.
 *
 * Demo shortcut: typing "@admin" or "@passenger" as the email maps to
 * the seeded local accounts (admin@masar.local / passenger@masar.local)
 * with password "1234" — handy for quickly demoing both modules.
 *
 * Sign-up always creates a passenger account. Required fields (name,
 * email, phone) are validated client-side and stored in user metadata
 * so the database trigger can persist them into public.profiles and
 * auto-generate the MASAR ID.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { TrainFront } from "lucide-react";

// Strict validation prevents bad data from ever reaching the database.
const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().email("Invalid email").max(255),
  phone: z.string().trim().min(7, "Invalid phone").max(20),
  national_id: z.string().trim().max(20).optional().or(z.literal("")),
  password: z.string().min(4, "Password must be at least 4 characters").max(72),
});

export default function Auth() {
  const navigate = useNavigate();
  const { session, role, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");

  // Once a session + role are known, route the user to the right module.
  useEffect(() => {
    if (loading || !session) return;
    if (role === "admin") navigate("/admin", { replace: true });
    else if (role === "passenger") navigate("/app", { replace: true });
  }, [loading, session, role, navigate]);

  /** Convert demo handles "@admin" / "@passenger" into real seeded emails. */
  const resolveEmail = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v === "@admin") return "admin@masar.local";
    if (v === "@passenger") return "passenger@masar.local";
    return v;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: resolveEmail(email),
      password,
    });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate input first so we never call the API with bad data.
    const parsed = signUpSchema.safeParse({
      full_name: fullName,
      email,
      phone,
      national_id: nationalId,
      password,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // Required by Supabase even when auto-confirm is on.
        emailRedirectTo: `${window.location.origin}/`,
        // Read by handle_new_user() trigger to populate public.profiles.
        data: {
          full_name: parsed.data.full_name,
          phone: parsed.data.phone,
          national_id: parsed.data.national_id || null,
          role: "passenger", // public sign-up is always a passenger
        },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created — signing you in…");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2 text-primary">
          <TrainFront className="h-6 w-6" />
          <h1 className="text-xl font-semibold">MASAR</h1>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Train Schedule &amp; Reservation Management.
          <br />
          Demo: sign in with <code>@admin</code> or <code>@passenger</code> and password{" "}
          <code>1234</code>.
        </p>

        {/* Tab switcher */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded py-1.5 transition ${
              mode === "signin" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded py-1.5 transition ${
              mode === "signup" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign up
          </button>
        </div>

        {mode === "signin" ? (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <Label htmlFor="email">Email or @handle</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+9665..."
                required
              />
            </div>
            <div>
              <Label htmlFor="national_id">National ID (optional)</Label>
              <Input
                id="national_id"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating account…" : "Create passenger account"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
