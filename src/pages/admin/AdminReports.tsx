/**
 * Admin — Reports module.
 *
 * Pure reports listing — NOT a dashboard. The admin sees a list of report
 * presets (Today, This week, This month, plus a custom range) and can
 * download each as a PDF in one click. No KPIs, no charts on this page.
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
  format, subDays, startOfDay, eachDayOfInterval,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
} from "date-fns";
import { downloadReport } from "@/lib/pdf";
import { Download, CalendarDays, CalendarRange, Calendar } from "lucide-react";

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

/** A report preset: a label + a function returning the [from, to] date range. */
interface ReportPreset {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  range: () => { from: Date; to: Date };
}

const PRESETS: ReportPreset[] = [
  {
    key: "daily",
    label: "Daily report",
    description: "All bookings and revenue for today.",
    icon: <CalendarDays className="h-5 w-5" />,
    range: () => ({ from: startOfDay(new Date()), to: new Date() }),
  },
  {
    key: "weekly",
    label: "Weekly report",
    description: "Current calendar week (Monday → Sunday).",
    icon: <CalendarRange className="h-5 w-5" />,
    range: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  {
    key: "monthly",
    label: "Monthly report",
    description: "Current calendar month from the 1st onwards.",
    icon: <Calendar className="h-5 w-5" />,
    range: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  },
];

export default function AdminReports() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  // Custom range — defaults to the last 30 days.
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo]     = useState(format(new Date(), "yyyy-MM-dd"));

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

  const priceById = useMemo(
    () => new Map(trips.map((t) => [t.id, Number(t.price_sar)])),
    [trips],
  );

  /** Build the full report payload for a given date range and trigger PDF download. */
  const buildAndDownload = (rangeFrom: Date, rangeTo: Date) => {
    const start = startOfDay(rangeFrom).getTime();
    const end   = startOfDay(rangeTo).getTime() + 86_400_000 - 1;
    const inRange = bookings.filter((b) => {
      const t = new Date(b.created_at).getTime();
      return t >= start && t <= end;
    });

    const active = inRange.filter((b) => b.status === "active");
    const revenue = active.reduce((s, b) => s + (priceById.get(b.trip_id) ?? 0), 0);
    const summary = {
      total: inRange.length,
      active: active.length,
      cancelled: inRange.length - active.length,
      revenue,
    };

    // Daily breakdown
    const days = eachDayOfInterval({ start: rangeFrom, end: rangeTo });
    const counts = new Map(days.map((d) => [
      startOfDay(d).toISOString(),
      { active: 0, cancelled: 0, revenue: 0 },
    ]));
    inRange.forEach((b) => {
      const k = startOfDay(new Date(b.created_at)).toISOString();
      const cell = counts.get(k);
      if (!cell) return;
      if (b.status === "active") {
        cell.active += 1;
        cell.revenue += priceById.get(b.trip_id) ?? 0;
      } else cell.cancelled += 1;
    });
    const daily = days.map((d) => ({
      day: format(d, "MMM d"),
      ...counts.get(startOfDay(d).toISOString())!,
    }));

    // Top routes by revenue
    const m = new Map<string, number>();
    inRange.filter((b) => b.status === "active").forEach((b) => {
      const tr = trips.find((t) => t.id === b.trip_id);
      if (!tr) return;
      const k = `${tr.origin} → ${tr.destination}`;
      m.set(k, (m.get(k) ?? 0) + Number(tr.price_sar));
    });
    const routes = Array.from(m.entries())
      .map(([route, revenue]) => ({ route, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    downloadReport({
      from: format(rangeFrom, "yyyy-MM-dd"),
      to: format(rangeTo, "yyyy-MM-dd"),
      summary,
      daily,
      routes,
    });
  };

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Generate and download operational reports as PDF documents.
        </p>
      </div>

      {/* Preset reports list */}
      <div className="mb-6 grid gap-3">
        {PRESETS.map((p) => {
          const { from: f, to: t } = p.range();
          return (
            <Card key={p.key} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {p.icon}
                </div>
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.description} ·{" "}
                    <span className="text-foreground">
                      {format(f, "MMM d, yyyy")}
                      {format(f, "yyyy-MM-dd") !== format(t, "yyyy-MM-dd") &&
                        ` → ${format(t, "MMM d, yyyy")}`}
                    </span>
                  </div>
                </div>
              </div>
              <Button onClick={() => buildAndDownload(f, t)}>
                <Download className="mr-1 h-4 w-4" /> Download PDF
              </Button>
            </Card>
          );
        })}

        {/* Custom range */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <div className="font-medium">Custom range report</div>
              <div className="text-xs text-muted-foreground">
                Pick any start and end date (no future dates allowed).
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>From</Label>
              <Input
                type="date"
                max={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>To</Label>
              <Input
                type="date"
                min={from}
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button
              onClick={() => buildAndDownload(new Date(from), new Date(to))}
              disabled={!from || !to || from > to}
            >
              <Download className="mr-1 h-4 w-4" /> Download PDF
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
