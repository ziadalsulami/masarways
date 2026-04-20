/**
 * MASAR landing page = combined Login / Sign-up screen.
 *
 * Demo shortcut: typing "@admin" or "@passenger" as the email maps to
 * the seeded local accounts (admin@masar.local / passenger@masar.local)
 * with password "1234" — handy for quickly demoing both modules.
 *
 * Sign-up always creates a passenger account. The phone number is split
 * in two: a country-code dropdown (default +966 for Saudi Arabia) and a
 * 10-digit local part. The two are joined before being stored so the
 * profile keeps a single canonical phone number like "+966500000000".
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { TrainFront } from "lucide-react";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/countries";

// Validate inputs strictly so bad data never reaches the database.
const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().email("Invalid email").max(255),
  // local phone part: digits only, exactly 10
  phone_local: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
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
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY.code);
  const [phoneLocal, setPhoneLocal] = useState("");

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
    const parsed = signUpSchema.safeParse({
      full_name: fullName,
      email,
      phone_local: phoneLocal,
      password,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    // Canonical phone = country code + local digits, e.g. "+966500000000".
    const fullPhone = `${countryCode}${parsed.data.phone_local}`;

    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        // Read by handle_new_user() trigger to populate public.profiles.
        data: {
          full_name: parsed.data.full_name,
          phone: fullPhone,
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

            {/* Phone — country code + 10-digit local */}
            <div>
              <Label htmlFor="phone">Phone</Label>
              <div className="flex gap-2">
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.iso} value={c.code}>
                        <span className="mr-1">{c.flag}</span>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="phone"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="5xxxxxxxx (10 digits)"
                  value={phoneLocal}
                  // Strip anything non-numeric so users can't paste bad data.
                  onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  required
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Default is Saudi Arabia (+966). Enter your 10-digit local number.
              </p>
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
