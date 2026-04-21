/**
 * Reset-password landing page.
 *
 * Supabase sends a recovery link that opens this page with a recovery
 * session attached. The user types a new password, we call updateUser()
 * which hashes it server-side and stores it in auth.users.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import PasswordInput from "@/components/PasswordInput";
import { TrainFront } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // Wait for Supabase to consume the recovery hash and create the session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 6) return toast.error("Password must be at least 6 characters.");
    if (pwd !== pwd2) return toast.error("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated. Please sign in.");
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-primary">
          <TrainFront className="h-7 w-7" />
          <h1 className="text-xl font-semibold">Set a new password</h1>
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="pwd">New password</Label>
              <PasswordInput id="pwd" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="pwd2">Confirm new password</Label>
              <PasswordInput id="pwd2" value={pwd2} onChange={(e) => setPwd2(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !ready}>
              {busy ? "Updating…" : ready ? "Update password" : "Waiting for recovery session…"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
