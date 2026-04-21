/**
 * MyAccount — shared by admins and passengers.
 *
 * Lets the signed-in user view their MASAR profile (read-only fields like
 * MASAR ID and role) and edit their basic info: full name, phone (with
 * country code), and email. Password changes go through Supabase Auth so
 * the new password is hashed server-side (we never store plain text).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import Greeting from "@/components/Greeting";
import PasswordInput from "@/components/PasswordInput";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COUNTRIES } from "@/lib/countries";
import { ADMIN_NAV } from "./admin/nav";
import { toast } from "sonner";

/** Split a stored phone like "+966500000000" into dial code + 10-digit local part. */
function splitPhone(stored: string): { dial: string; local: string } {
  const found = COUNTRIES.find((c) => stored.startsWith(c.code));
  if (found) return { dial: found.code, local: stored.slice(found.code.length) };
  return { dial: "+966", local: stored.replace(/^\+?\d{1,4}/, "") };
}

export default function MyAccount() {
  const { profile, role, refresh } = useAuth();

  // Editable profile fields.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [dial, setDial] = useState("+966");
  const [localPhone, setLocalPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change form.
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  // Hydrate the form whenever the profile becomes available.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setEmail(profile.email);
    const { dial: d, local } = splitPhone(profile.phone || "");
    setDial(d);
    setLocalPhone(local);
  }, [profile]);

  if (!profile) {
    return (
      <AppShell>
        <p className="text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  // Nav depends on role so each user sees their own module's links.
  const nav =
    role === "admin"
      ? ADMIN_NAV
      : [
          { to: "/app", label: "Trips" },
          { to: "/app/bookings", label: "My bookings" },
        ];

  /** Save name / phone / email back to the database (and to Supabase Auth for email). */
  const saveProfile = async () => {
    // Phone validation — exactly 10 digits, numbers only.
    if (!/^\d{10}$/.test(localPhone)) {
      toast.error("Phone number must be exactly 10 digits.");
      return;
    }
    if (!fullName.trim()) {
      toast.error("Full name is required.");
      return;
    }
    setSavingProfile(true);

    // 1) Update profiles table.
    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: `${dial}${localPhone}`,
        email,
      })
      .eq("id", profile.id);

    // 2) If the email changed, update it in Supabase Auth too (sends confirmation).
    let authErr: { message: string } | null = null;
    if (email !== profile.email) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) authErr = error;
    }

    setSavingProfile(false);
    if (profErr) return toast.error(profErr.message);
    if (authErr) return toast.error(authErr.message);
    await refresh();
    toast.success("Profile updated.");
  };

  /** Change password — Supabase hashes it server-side (bcrypt). Never stored as plain text. */
  const changePassword = async () => {
    if (newPwd.length < 6) return toast.error("Password must be at least 6 characters.");
    if (newPwd !== confirmPwd) return toast.error("Passwords do not match.");
    setSavingPwd(true);
    // Make sure we have a fresh session (some sessions can be stale after long idle).
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSavingPwd(false);
      return toast.error("Your session expired. Please sign in again.");
    }
    const { data, error } = await supabase.auth.updateUser({ password: newPwd });
    setSavingPwd(false);
    if (error) return toast.error(error.message);
    if (!data.user) return toast.error("Could not update password — please try again.");
    setNewPwd("");
    setConfirmPwd("");
    toast.success("Password updated successfully.");
  };

  return (
    <AppShell nav={nav}>
      <Greeting subtitle="Manage your MASAR profile and security settings." />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">My account</h1>
        <p className="text-sm text-muted-foreground">
          View and update your MASAR profile information.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Read-only identity card */}
        <Card className="p-5">
          <h2 className="mb-4 font-medium">Identity</h2>
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-muted-foreground">MASAR ID</dt>
            <dd className="font-mono">{profile.masar_id}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="capitalize">{role}</dd>
            <dt className="text-muted-foreground">Member since</dt>
            <dd>—</dd>
          </dl>
        </Card>

        {/* Editable profile */}
        <Card className="p-5">
          <h2 className="mb-4 font-medium">Basic information</h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <div className="flex gap-2">
                <Select value={dial} onValueChange={setDial}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code + c.iso} value={c.code}>
                        {c.flag} {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10 digits"
                  value={localPhone}
                  onChange={(e) => setLocalPhone(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Card>

        {/* Password — hashed by the auth backend, never stored plain text */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 font-medium">Change password</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Your password is stored securely (hashed) by the authentication system — never as
            plain text.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pwd">New password</Label>
              <PasswordInput
                id="pwd"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pwd2">Confirm new password</Label>
              <PasswordInput
                id="pwd2"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
              />
            </div>
          </div>
          <Button className="mt-4" onClick={changePassword} disabled={savingPwd}>
            {savingPwd ? "Updating…" : "Update password"}
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}
