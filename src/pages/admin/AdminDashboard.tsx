/**
 * Administrator dashboard — KPIs + charts + occupancy table.
 *
 * Charts (recharts):
 *   1. Bookings per day (last 14 days) — bar chart
 *   2. Revenue by route             — horizontal bar chart
 *   3. Top trips by occupancy       — visual bars in the table
 *
 * Live updates:
 *   Subscribes to bookings changes via Realtime so KPIs and charts
 *   re-compute whenever a passenger books or cancels.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import Greeting from "@/components/Greeting";
import { Card } from "@/components/ui/card";
import { ADMIN_NAV } from "./nav";
import { format, subDays, startOfDay } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { TrainFront, Ticket, Users, Wallet } from "lucide-react";

// Palette derived from the design system primary token plus complementary hues.
const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(158 50% 45%)",
  "hsl(40 80% 55%)",
  "hsl(0 70% 60%)",
  "hsl(220 60% 55%)",
  "hsl(280 50% 60%)",
];

interface TripRow {
  id: string;
  origin: string;
  destination: string;
  departure_at: string;
  total_seats: number;
  price_sar: number;
  trains: { code: string; name: string } | null;
}

interface BookingRow {
  id: string;
  trip_id: string;
  status: "active" | "cancelled";
  created_at: string;
}

export default function AdminDashboard() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [trainCount, setTrainCount] = useState(0);
  const [passengerCount, setPassengerCount] = useState(0);

  /** Pull everything we need to compute the dashboard. */
  const loadAll = async () => {
    const [trainsRes, tripsRes, bookingsRes, paxRes] = await Promise.all([
      supabase.from("trains").select("id", { count: "exact", head: true }),
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, total_seats, price_sar, trains(code,name)"),
      supabase.from("bookings").select("id, trip_id, status, created_at"),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .like("masar_id", "P%"),
    ]);
    setTrainCount(trainsRes.count ?? 0);
    setTrips((tripsRes.data ?? []) as TripRow[]);
    setBookings((bookingsRes.data ?? []) as BookingRow[]);
    setPassengerCount(paxRes.count ?? 0);
  };

  // Initial load + live updates on bookings.
  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel("admin-bookings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ---- Derived datasets -------------------------------------------------

  const priceById = useMemo(
    () => new Map(trips.map((t) => [t.id, Number(t.price_sar)])),
    [trips],
  );

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status === "active"),
    [bookings],
  );

  // KPIs
  const stats = useMemo(() => {
    const revenue = activeBookings.reduce((s, b) => s + (priceById.get(b.trip_id) ?? 0), 0);
    const upcoming = trips.filter((t) => new Date(t.departure_at) > new Date()).length;
    return {
      trains: trainCount,
      passengers: passengerCount,
      activeBookings: activeBookings.length,
      upcoming,
      revenue,
    };
  }, [activeBookings, priceById, trips, trainCount, passengerCount]);

  // Bookings per day (last 14 days)
  const dailyData = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) =>
      startOfDay(subDays(new Date(), 13 - i)),
    );
    const counts = new Map(days.map((d) => [d.toISOString(), 0]));
    activeBookings.forEach((b) => {
      const k = startOfDay(new Date(b.created_at)).toISOString();
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return days.map((d) => ({
      day: format(d, "MMM d"),
      bookings: counts.get(d.toISOString()) ?? 0,
    }));
  }, [activeBookings]);

  // Revenue by route
  const revenueByRoute = useMemo(() => {
    const map = new Map<string, number>();
    activeBookings.forEach((b) => {
      const trip = trips.find((t) => t.id === b.trip_id);
      if (!trip) return;
      const key = `${trip.origin} → ${trip.destination}`;
      map.set(key, (map.get(key) ?? 0) + Number(trip.price_sar));
    });
    return Array.from(map.entries())
      .map(([route, revenue]) => ({ route, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [activeBookings, trips]);

  // Upcoming-trips table with occupancy
  const upcomingTrips = useMemo(() => {
    const now = Date.now();
    return trips
      .filter((t) => new Date(t.departure_at).getTime() > now)
      .sort((a, b) => +new Date(a.departure_at) - +new Date(b.departure_at))
      .map((t) => ({
        ...t,
        booked: activeBookings.filter((b) => b.trip_id === t.id).length,
      }));
  }, [trips, activeBookings]);

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Administrator Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live operational overview — updates as passengers book and cancel.
          </p>
        </div>
        <span className="hidden items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live
        </span>
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={<TrainFront className="h-4 w-4" />} label="Trains"           value={stats.trains} />
        <Stat icon={<Users className="h-4 w-4" />}      label="Passengers"       value={stats.passengers} />
        <Stat icon={<Ticket className="h-4 w-4" />}     label="Active bookings"  value={stats.activeBookings} />
        <Stat icon={<Wallet className="h-4 w-4" />}     label="Revenue (SAR)"    value={stats.revenue.toFixed(2)} />
      </div>

      {/* Charts row */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Bookings — last 14 days</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="bookings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Revenue by route (top 6)</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByRoute} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  type="category"
                  dataKey="route"
                  width={120}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v.toFixed(2)} SAR`, "Revenue"]}
                />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Upcoming trips occupancy */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">
          Upcoming trips · occupancy
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Train</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">Departure</th>
                <th className="px-4 py-2">Seats</th>
                <th className="px-4 py-2 w-1/3">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {upcomingTrips.map((t) => {
                const pct = Math.round((t.booked / t.total_seats) * 100);
                return (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {t.trains?.code}{" "}
                      <span className="text-muted-foreground">· {t.trains?.name}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {t.origin} → {t.destination}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {format(new Date(t.departure_at), "yyyy-MM-dd HH:mm")}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {t.booked} / {t.total_seats}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {upcomingTrips.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No upcoming trips.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}

/** KPI card with icon. */
function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-4 transition hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}
