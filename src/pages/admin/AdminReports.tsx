/**
 * Admin — Reports module.
 *
 * UX:
 *   - Top: a single "Generate report" button. Opens a clean dialog where the
 *     admin picks a kind (daily / weekly / monthly) and a starting date. The
 *     range is auto-derived (1 / 7 / 30 days). Future dates are blocked.
 *   - Bottom: History — every report ever generated, including auto-seeded
 *     daily / weekly / monthly entries the system creates on first load so
 *     the admin always has recent reports to download.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ADMIN_NAV } from "./nav";
import {
  format, addDays, subDays, startOfDay, eachDayOfInterval,
} from "date-fns";
import { downloadReport } from "@/lib/pdf";
import {
  Download, History, FileText, CalendarDays, CalendarRange,
  Calendar as CalendarIcon, Plus,
} from "lucide-react";
import { toast } from "sonner";

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
type ReportKind = "daily" | "weekly" | "monthly";
interface ReportRow {
  id: string;
  kind: ReportKind | "custom";
  from_date: string;
  to_date: string;
  total_bookings: number;
  active_bookings: number;
  cancelled_bookings: number;
  revenue_sar: number;
  created_at: string;
}

const KIND_META: Record<ReportKind, { label: string; days: number; icon: React.ReactNode }> = {
  daily:   { label: "Daily",   days: 1,  icon: <CalendarDays className="h-4 w-4" /> },
  weekly:  { label: "Weekly",  days: 7,  icon: <CalendarRange className="h-4 w-4" /> },
  monthly: { label: "Monthly", days: 30, icon: <CalendarIcon className="h-4 w-4" /> },
};

const KIND_LABEL: Record<ReportRow["kind"], string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom",
};

/** Derive the [from, to] range for a kind given a starting date. */
const rangeFor = (kind: ReportKind, startISO: string): { from: Date; to: Date } => {
  const from = startOfDay(new Date(startISO));
  const to = kind === "daily" ? from : addDays(from, KIND_META[kind].days - 1);
  return { from, to };
};

export default function AdminReports() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [history, setHistory] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // Dialog form state.
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [kind, setKind] = useState<ReportKind>("daily");
  const [startDate, setStartDate] = useState<string>(todayStr);

  const loadHistory = async () => {
    const { data } = await (supabase as any)
      .from("reports")
      .select("*")
      .order("from_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    setHistory((data ?? []) as ReportRow[]);
  };

  useEffect(() => {
    (async () => {
      const [bRes, tRes] = await Promise.all([
        supabase.from("bookings").select("id, trip_id, status, created_at"),
        supabase.from("trips").select("id, origin, destination, price_sar"),
      ]);
      setBookings((bRes.data ?? []) as Booking[]);
      setTrips((tRes.data ?? []) as Trip[]);
      await loadHistory();
      setLoading(false);
    })();
  }, []);

  const priceById = useMemo(
    () => new Map(trips.map((t) => [t.id, Number(t.price_sar)])),
    [trips],
  );

  /** Compute the report payload for a date range. */
  const buildPayload = (rangeFrom: Date, rangeTo: Date) => {
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
    return { summary, daily, routes };
  };

  /** Persist a report row (skipping if an identical kind+from+to already exists). */
  const persistReport = async (
    rangeFrom: Date,
    rangeTo: Date,
    rKind: ReportRow["kind"],
    generatedBy: string | null,
  ) => {
    const fromStr = format(rangeFrom, "yyyy-MM-dd");
    const toStr   = format(rangeTo,   "yyyy-MM-dd");
    const dup = history.find(
      (r) => r.kind === rKind && r.from_date === fromStr && r.to_date === toStr,
    );
    if (dup) return dup;
    const { summary } = buildPayload(rangeFrom, rangeTo);
    const { data } = await (supabase as any).from("reports").insert({
      kind: rKind,
      from_date: fromStr,
      to_date: toStr,
      total_bookings: summary.total,
      active_bookings: summary.active,
      cancelled_bookings: summary.cancelled,
      revenue_sar: summary.revenue,
      generated_by: generatedBy,
    }).select("*").single();
    return data as ReportRow | null;
  };

  /** Auto-seed recent daily / weekly / monthly reports if missing. */
  useEffect(() => {
    if (loading) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const today = startOfDay(new Date());
      const seeds: { kind: ReportKind; from: Date; to: Date }[] = [];

      // Last 7 days as individual daily reports.
      for (let i = 0; i < 7; i++) {
        const d = subDays(today, i);
        seeds.push({ kind: "daily", from: d, to: d });
      }
      // Last 4 weekly reports (rolling 7-day windows ending today, 7d ago, …).
      for (let i = 0; i < 4; i++) {
        const to = subDays(today, i * 7);
        const from = subDays(to, 6);
        seeds.push({ kind: "weekly", from, to });
      }
      // Last 3 monthly reports (rolling 30-day windows).
      for (let i = 0; i < 3; i++) {
        const to = subDays(today, i * 30);
        const from = subDays(to, 29);
        seeds.push({ kind: "monthly", from, to });
      }

      let created = 0;
      for (const s of seeds) {
        const fromStr = format(s.from, "yyyy-MM-dd");
        const toStr   = format(s.to,   "yyyy-MM-dd");
        const exists = history.some(
          (r) => r.kind === s.kind && r.from_date === fromStr && r.to_date === toStr,
        );
        if (exists) continue;
        await persistReport(s.from, s.to, s.kind, user?.id ?? null);
        created += 1;
      }
      if (created > 0) await loadHistory();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  /** Download (and persist if new) a report from the dialog. */
  const generateFromDialog = async () => {
    if (!startDate) return toast.error("Pick a starting date.");
    const { from, to } = rangeFor(kind, startDate);
    if (to.getTime() > Date.now()) {
      return toast.error("Reports cannot include future dates.");
    }
    const { data: { user } } = await supabase.auth.getUser();
    await persistReport(from, to, kind, user?.id ?? null);
    await loadHistory();
    const { summary, daily, routes } = buildPayload(from, to);
    downloadReport({
      from: format(from, "yyyy-MM-dd"),
      to:   format(to,   "yyyy-MM-dd"),
      summary, daily, routes,
    });
    toast.success(`${KIND_META[kind].label} report generated.`);
    setOpen(false);
  };

  /** Re-download a historic report (recomputed from current data). */
  const reDownload = (r: ReportRow) => {
    const f = new Date(r.from_date);
    const t = new Date(r.to_date);
    const { summary, daily, routes } = buildPayload(f, t);
    downloadReport({
      from: r.from_date, to: r.to_date, summary, daily, routes,
    });
  };

  // Max start date so that the derived range never extends into the future.
  const maxStart = useMemo(() => {
    const d = subDays(new Date(), KIND_META[kind].days - 1);
    return format(d, "yyyy-MM-dd");
  }, [kind]);

  const previewRange = useMemo(() => {
    if (!startDate) return null;
    const { from, to } = rangeFor(kind, startDate);
    return kind === "daily"
      ? format(from, "EEE d MMM yyyy")
      : `${format(from, "MMM d")} → ${format(to, "MMM d, yyyy")}`;
  }, [kind, startDate]);

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            All reports the system has generated. Use{" "}
            <span className="font-medium">Generate report</span> to create a new one.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> Generate report
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Generate a report</DialogTitle>
              <DialogDescription>
                Pick a report type and starting date — the range is calculated for you.
                Future dates are not allowed.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label className="mb-2 block">Report type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(KIND_META) as ReportKind[]).map((k) => (
                    <button
                      type="button"
                      key={k}
                      onClick={() => {
                        setKind(k);
                        // If current start would push range into future, clamp it.
                        const newMax = format(subDays(new Date(), KIND_META[k].days - 1), "yyyy-MM-dd");
                        if (startDate > newMax) setStartDate(newMax);
                      }}
                      className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition ${
                        kind === k
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {KIND_META[k].icon}
                      <span className="font-medium">{KIND_META[k].label}</span>
                      <span className="text-[10px] opacity-70">
                        {KIND_META[k].days} day{KIND_META[k].days > 1 ? "s" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="start-date">
                  {kind === "daily" ? "Date" : "Starting date"}
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  max={maxStart}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                {previewRange && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Range: <span className="font-medium text-foreground">{previewRange}</span>
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={generateFromDialog}>
                <Download className="mr-1 h-4 w-4" /> Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* History */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
          <History className="h-4 w-4 text-muted-foreground" /> Reports history
          <span className="ml-auto text-xs text-muted-foreground">
            {history.length} report{history.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Range</th>
                <th className="px-4 py-2">Bookings</th>
                <th className="px-4 py-2">Revenue (SAR)</th>
                <th className="px-4 py-2">Generated</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {format(new Date(r.from_date), "MMM d, yyyy")}
                    {r.from_date !== r.to_date && ` → ${format(new Date(r.to_date), "MMM d, yyyy")}`}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.active_bookings} active · {r.cancelled_bookings} cancelled
                  </td>
                  <td className="px-4 py-2 tabular-nums">{Number(r.revenue_sar).toFixed(2)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => reDownload(r)}>
                      <Download className="mr-1 h-3 w-3" /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
              {history.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    No reports yet — click "Generate report" above.
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
