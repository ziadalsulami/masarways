/**
 * Route guard. Redirects unauthenticated users to /auth and, when a
 * specific role is required, redirects users with the wrong role to
 * the catch-all home page so they can't sneak into another module.
 */
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, AppRole } from "@/lib/auth";

interface Props {
  children: ReactNode;
  requireRole?: AppRole;
}

export default function ProtectedRoute({ children, requireRole }: Props) {
  const { session, role, loading } = useAuth();

  // Show nothing while we're still figuring out who the user is.
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  // Not signed in → bounce to login.
  if (!session) return <Navigate to="/auth" replace />;

  // Signed in but wrong role → bounce to home which will redirect properly.
  if (requireRole && role !== requireRole) return <Navigate to="/" replace />;

  return <>{children}</>;
}
