/**
 * Admin — All bookings table.
 * Filterable by status. Admin can cancel any active booking (which
 * releases the seat thanks to the partial unique index).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_NAV } from "./nav";
import { format } from "date-fns";
import { toast } from "sonner";
import { Search } from "lucide-react";

interface Row {
  id: string;
  reference: string;
  seat_number: number;
  status: "active" | "cancelled";
  created_at: string;
  profiles: { masar_id: string; full_name: string } | null;
  trips: { origin: string; destination: string; departure_at: string; trains: { code: string } | null } | null;
}

const FILTERS = ["all", "active", "departed", "cancelled"] as const;
type DisplayStatus = "active" | "departed" | "cancelled";

const displayStatus = (r: Row): DisplayStatus => {
  if (r.status === "cancelled") return "cancelled";
  if (r.trips && new Date(r.trips.departure_at).getTime() < Date.now()) return "departed";
  return "active";
};

const STATUS_STYLE: Record<DisplayStatus, string> = {
  active: "bg-accent text-accent-foreground",
  departed: "bg-primary/15 text-primary",
  cancelled: "bg-muted text-muted-foreground",
};

export default function AdminBookings() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("bookings")
      .select("id, reference, seat_number, status, created_at, profiles(masar_id, full_name), trips(origin, destination, departure_at, trains(code))")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as Row[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-bookings-table")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const cancel = async (id: string) => {
    if (!confirm("Cancel this booking? The seat will be released.")) return;
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Booking cancelled.");
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && displayStatus(r) !== filter) return false;
      if (!q) return true;
      const blob = [
        r.reference,
        r.profiles?.full_name,
        r.profiles?.masar_id,
        r.trips?.origin,
        r.trips?.destination,
        r.trips?.trains?.code,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [rows, filter, query]);

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">{visible.length} of {rows.length} bookings shown.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-muted p-0.5 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-1 capitalize transition ${filter === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Passenger</th>
                <th className="px-4 py-2">Train</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">Departure</th>
                <th className="px-4 py-2">Seat</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Booked</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{r.reference}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.profiles?.full_name}{" "}
                    <span className="text-muted-foreground">({r.profiles?.masar_id})</span>
                  </td>
                  <td className="px-4 py-2">{r.trips?.trains?.code}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.trips?.origin} → {r.trips?.destination}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.trips && format(new Date(r.trips.departure_at), "yyyy-MM-dd HH:mm")}</td>
                  <td className="px-4 py-2">#{r.seat_number}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${r.status === "active" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}</td>
                  <td className="px-4 py-2 text-right">
                    {r.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => cancel(r.id)}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">No bookings match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
