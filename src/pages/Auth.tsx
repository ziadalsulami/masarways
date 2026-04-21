/**
 * MASAR landing page = combined Login / Sign-up / Forgot-password screen.
 *
 * - Centered logo + title above the card.
 * - Animated green blurred orbs in the background for atmosphere.
 * - "Forgot password?" link sends a reset email via Supabase Auth.
 * - Password fields use the shared <PasswordInput> with an eye toggle.
 *
 * Demo handles "@admin" / "@passenger" still work but the helper note has
 * been removed from the UI.
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
import PasswordInput from "@/components/PasswordInput";

// Validate inputs strictly so bad data never reaches the database.
// Password rules: min 8 chars, at least one letter, one number, one special character.
const PASSWORD_RULES_MSG =
  "At least 8 characters, including a letter, a number, and a special character (e.g. !@#$%).";
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().email("Invalid email").max(255),
  phone_local: z.string().trim().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
  password: passwordSchema,
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] });

type Mode = "signin" | "signup" | "forgot";

export default function Auth() {
  const navigate = useNavigate();
  const { session, role, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY.code);
  const [phoneLocal, setPhoneLocal] = useState("");

  useEffect(() => {
    if (loading || !session) return;
    if (role === "admin") navigate("/admin", { replace: true });
    else if (role === "passenger") navigate("/app", { replace: true });
  }, [loading, session, role, navigate]);

  /** "@admin" / "@passenger" demo handles → real seeded emails. */
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
      confirm: confirmPwd,
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    const fullPhone = `${countryCode}${parsed.data.phone_local}`;
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          full_name: parsed.data.full_name,
          phone: fullPhone,
          role: "passenger",
        },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created — signing you in…");
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Enter your email first.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resolveEmail(email), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Reset link sent — check your email.");
      setMode("signin");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Animated green blurred orbs in the background */}
      <div className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-blob" />
        <div className="absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-primary/25 blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-primary/20 blur-3xl animate-blob animation-delay-4000" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Centered brand */}
        <div className="mb-6 flex flex-col items-center gap-2 text-primary">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
            <TrainFront className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold">MASAR</h1>
          <p className="text-center text-sm text-muted-foreground">
            Train Schedule &amp; Reservation Management
          </p>
        </div>

        <Card className="w-full p-8 backdrop-blur-sm bg-card/90">
          {mode !== "forgot" && (
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
          )}

          {mode === "signin" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}

          {mode === "signup" && (
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
                    onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Default is Saudi Arabia (+966).
                </p>
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">{PASSWORD_RULES_MSG}</p>
              </div>
              <div>
                <Label htmlFor="confirm_password">Confirm password</Label>
                <PasswordInput
                  id="confirm_password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  required
                />
                {confirmPwd && password !== confirmPwd && (
                  <p className="mt-1 text-xs text-destructive">Passwords do not match.</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Create passenger account"}
              </Button>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <h2 className="text-lg font-medium">Reset your password</h2>
                <p className="text-sm text-muted-foreground">
                  Enter your email and we'll send you a reset link.
                </p>
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
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to sign in
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
