/**
 * Shared layout for every authenticated page: top bar with the MASAR
 * brand, the user's MASAR ID, and a sign-out button. Children render
 * inside a centered container.
 */
import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { TrainFront, LogOut } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional nav links rendered next to the brand. */
  nav?: { to: string; label: string }[];
}

export default function AppShell({ children, nav = [] }: Props) {
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold text-primary">
              <TrainFront className="h-5 w-5" />
              MASAR
            </Link>
            <nav className="hidden gap-4 md:flex">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <div className="hidden text-right text-xs text-muted-foreground sm:block">
                <div className="font-medium text-foreground">{profile.full_name}</div>
                <div>
                  {profile.masar_id} · {role}
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
