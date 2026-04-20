/**
 * Root route. Redirects to the right place depending on auth state:
 * - not signed in     → /auth (login / signup)
 * - admin             → /admin
 * - passenger         → /app
 */
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const { session, role, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/auth" replace />;
  if (role === "admin") return <Navigate to="/admin" replace />;
  return <Navigate to="/app" replace />;
}
