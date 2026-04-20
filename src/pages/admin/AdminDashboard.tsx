/**
 * Administrator dashboard.
 *
 * Shows headline KPIs (total trains, upcoming trips, active bookings,
 * revenue from active bookings) and a list of upcoming trips with
 * occupancy. Numbers come from Supabase via plain SELECTs — RLS is
 * already configured so admins can read everything.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

interface TripRow {
  id: string;
  origin: string;
  destination: string;
  departure_at: string;
  total_seats: number;
  price_sar: number;
  trains: { code: string; name: string } | null;
  active_bookings: number;
}

interface Stats {
  trains: number;
  upcomingTrips: number;
  activeBookings: number;
  revenue: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);

  useEffect(() => {
    (async () => {
      // Pull everything we need to compute KPIs in one round of queries.
      const nowIso = new Date().toISOString();
      const [trainsRes, tripsRes, bookingsRes] = await Promise.all([
        supabase.from("trains").select("id", { count: "exact", head: true }),
        supabase
          .from("trips")
          .select("id, origin, destination, departure_at, total_seats, price_sar, trains(code,name)")
          .gte("departure_at", nowIso)
          .order("departure_at", { ascending: true }),
        supabase.from("bookings").select("trip_id, status").eq("status", "active"),
      ]);

      const activeBookings = bookingsRes.data ?? [];
      // Bookings count per trip (used both for the list and for revenue).
      const perTrip = new Map<string, number>();
      activeBookings.forEach((b) => perTrip.set(b.trip_id, (perTrip.get(b.trip_id) ?? 0) + 1));

      const tripList: TripRow[] = (tripsRes.data ?? []).map((t: any) => ({
        ...t,
        active_bookings: perTrip.get(t.id) ?? 0,
      }));

      // Revenue = price * active bookings, summed across ALL trips
      // (we need a tiny extra fetch to include past trips' revenue).
      const { data: allTrips } = await supabase.from("trips").select("id, price_sar");
      const priceById = new Map((allTrips ?? []).map((t: any) => [t.id, Number(t.price_sar)]));
      const revenue = activeBookings.reduce(
        (sum, b) => sum + (priceById.get(b.trip_id) ?? 0),
        0,
      );

      setStats({
        trains: trainsRes.count ?? 0,
        upcomingTrips: tripList.length,
        activeBookings: activeBookings.length,
        revenue,
      });
      setTrips(tripList);
    })();
  }, []);

  return (
    <AppShell
      nav={[
        { to: "/admin", label: "Dashboard" },
        { to: "/admin/trips", label: "Trips" },
        { to: "/admin/passengers", label: "Passengers" },
      ]}
    >
      <h1 className="mb-6 text-2xl font-semibold">Administrator Dashboard</h1>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Trains" value={stats?.trains ?? "—"} />
        <Stat label="Upcoming trips" value={stats?.upcomingTrips ?? "—"} />
        <Stat label="Active bookings" value={stats?.activeBookings ?? "—"} />
        <Stat
          label="Revenue (SAR)"
          value={stats ? stats.revenue.toFixed(2) : "—"}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">
          Upcoming trips · occupancy
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Train</th>
              <th className="px-4 py-2">Route</th>
              <th className="px-4 py-2">Departure</th>
              <th className="px-4 py-2">Seats</th>
              <th className="px-4 py-2">Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => {
              const pct = Math.round((t.active_bookings / t.total_seats) * 100);
              return (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {t.trains?.code} <span className="text-muted-foreground">· {t.trains?.name}</span>
                  </td>
                  <td className="px-4 py-2">
                    {t.origin} → {t.destination}
                  </td>
                  <td className="px-4 py-2">{format(new Date(t.departure_at), "yyyy-MM-dd HH:mm")}</td>
                  <td className="px-4 py-2">
                    {t.active_bookings} / {t.total_seats}
                  </td>
                  <td className="px-4 py-2">{pct}%</td>
                </tr>
              );
            })}
            {trips.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No upcoming trips.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}

/** Small KPI card. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
