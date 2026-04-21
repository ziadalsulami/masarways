/**
 * Time-aware greeting banner shown at the top of dashboards.
 * Picks "Good morning / afternoon / evening" based on the local clock and
 * addresses the user by their first name.
 */
import { useAuth } from "@/lib/auth";

export default function Greeting({ subtitle }: { subtitle?: string }) {
  const { profile } = useAuth();
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = profile?.full_name?.split(" ")[0] ?? "there";
  return (
    <div className="mb-4">
      <h2 className="text-lg font-medium text-foreground">
        {part}, <span className="text-primary">{first}</span> 👋
      </h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
