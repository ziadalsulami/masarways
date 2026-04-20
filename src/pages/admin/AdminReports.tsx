/**
 * Admin — Reports & analytics.
 * Pickable date range (default last 30 days) and a one-click PDF export.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_NAV } from "./nav";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from "recharts";
import { format, subDays, startOfDay, eachDayOfInterval } from "date-fns";
import { downloadReport } from "@/lib/pdf";
import { Download } from "lucide-react";

interface Booking {
  id: string;
  trip_id: string;
  status: "active" | "cancelled";
  created_at: string;
}
interface Trip {
  id: string;
  origin: string;
  destination: string;
  price_sar: number;
}

export default function AdminReports() {
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo]     = useState(format(new Date(), "yyyy-MM-dd"));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    (async () => {
      const [bRes, tRes] = await Promise.all([
        supabase.from("bookings").select("id, trip_id, status, created_at"),
        supabase.from("trips").select("id, origin, destination, price_sar"),
      ]);
      setBookings((bRes.data ?? []) as Booking[]);
      setTrips((tRes.data ?? []) as Trip[]);
    })();
  }, []);

  const priceById = useMemo(() => new Map(trips.map((t) => [t.id, Number(t.price_sar)])), [trips]);

  // Filter bookings to the picked range.
  const inRange = useMemo(() => {
    const start = startOfDay(new Date(from)).getTime();
    const end   = startOfDay(new Date(to)).getTime() + 86_400_000 - 1;
    return bookings.filter((b) => {
      const t = new Date(b.created_at).getTime();
      return t >= start && t <= end;
    });
  }, [bookings, from, to]);

  const summary = useMemo(() => {
    const active = inRange.filter((b) => b.status === "active");
    const revenue = active.reduce((s, b) => s + (priceById.get(b.trip_id) ?? 0), 0);
    return {
      total: inRange.length,
      active: active.length,
      cancelled: inRange.length - active.length,
      revenue,
    };
  }, [inRange, priceById]);

  // Series for the line chart — booking count per day.
  const dailySeries = useMemo(() => {
    const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
    const counts = new Map(days.map((d) => [startOfDay(d).toISOString(), { active: 0, cancelled: 0, revenue: 0 }]));
    inRange.forEach((b) => {
      const k = startOfDay(new Date(b.created_at)).toISOString();
      const cell = counts.get(k);
      if (!cell) return;
      if (b.status === "active") {
        cell.active += 1;
        cell.revenue += priceById.get(b.trip_id) ?? 0;
      } else cell.cancelled += 1;
    });
    return days.map((d) => ({
      day: format(d, "MMM d"),
      ...counts.get(startOfDay(d).toISOString())!,
    }));
  }, [inRange, from, to, priceById]);

  // Top routes by revenue
  const routeSeries = useMemo(() => {
    const m = new Map<string, number>();
    inRange.filter((b) => b.status === "active").forEach((b) => {
      const tr = trips.find((t) => t.id === b.trip_id);
      if (!tr) return;
      const k = `${tr.origin} → ${tr.destination}`;
      m.set(k, (m.get(k) ?? 0) + Number(tr.price_sar));
    });
    return Array.from(m.entries())
      .map(([route, revenue]) => ({ route, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [inRange, trips]);

  const exportPdf = () => {
    downloadReport({
      from, to,
      summary,
      daily: dailySeries,
      routes: routeSeries,
    });
  };

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Booking and revenue analytics for a date range.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={exportPdf}><Download className="mr-1 h-4 w-4" /> Export PDF</Button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Bookings"     value={summary.total} />
        <Stat label="Active"       value={summary.active} />
        <Stat label="Cancelled"    value={summary.cancelled} />
        <Stat label="Revenue (SAR)" value={summary.revenue.toFixed(2)} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Bookings per day</div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={dailySeries}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Line type="monotone" dataKey="active"    stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cancelled" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Revenue by route (top 8)</div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={routeSeries} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="route" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(2)} SAR`, "Revenue"]} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}
