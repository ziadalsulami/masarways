/**
 * Shared layout for every authenticated page: top bar with the MASAR
 * brand and a circular user-avatar menu in the top-right corner.
 *
 * The avatar dropdown holds the user's identity (name + MASAR id + role),
 * "My account" link, theme toggle and "Sign out" — replacing the older
 * row of inline buttons for a cleaner mobile-friendly UI.
 */
import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { TrainFront, LogOut, Sun, Moon, User, Settings } from "lucide-react";
import { useTheme } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface Props {
  children: ReactNode;
  /** Optional nav links rendered next to the brand. */
  nav?: { to: string; label: string }[];
}

export default function AppShell({ children, nav = [] }: Props) {
  const { profile, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  // Initials for the avatar fallback (e.g. "Ali Khan" → "AK").
  const initials =
    profile?.full_name
      ?.split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "U";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
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

          {/* User-avatar dropdown — single rounded button replaces the old inline row. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full border border-border"
                aria-label="Open user menu"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {profile && (
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="font-medium">{profile.full_name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {profile.masar_id} · {role}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{profile.email}</span>
                </DropdownMenuLabel>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/account")}>
                <User className="mr-2 h-4 w-4" /> My account
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(role === "admin" ? "/admin" : "/app")}
              >
                <Settings className="mr-2 h-4 w-4" /> Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggle}>
                {theme === "dark" ? (
                  <>
                    <Sun className="mr-2 h-4 w-4" /> Light mode
                  </>
                ) : (
                  <>
                    <Moon className="mr-2 h-4 w-4" /> Dark mode
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
