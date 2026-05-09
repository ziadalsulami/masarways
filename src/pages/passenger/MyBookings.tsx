/**
 * Passenger — list of own bookings.
 * "Manage booking" dialog shows full trip details and lets the user
 * cancel (if the trip is still upcoming) or re-download the receipt.
 *
 * Visible status reflects reality:
 *   - active + departure in past  → "departed" (read-only)
 *   - active + departure future   → "active"
 *   - cancelled                   → "cancelled"
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import { downloadReceipt } from "@/lib/pdf";
import { Download, X, TrainFront, MapPin, Clock } from "lucide-react";

interface Booking {
  id: string;
  reference: string;
  seat_number: number;
  status: "active" | "cancelled";
  trips: {
    origin: string;
    destination: string;
    departure_at: string;
    arrival_at: string;
    price_sar: number;
    trains: { code: string; name: string } | null;
  } | null;
}

type DisplayStatus = "active" | "departed" | "cancelled";

const displayStatus = (b: Booking): DisplayStatus => {
  if (b.status === "cancelled") return "cancelled";
  if (b.trips && new Date(b.trips.departure_at).getTime() < Date.now()) return "departed";
  return "active";
};

const STATUS_STYLE: Record<DisplayStatus, string> = {
  active: "bg-accent text-accent-foreground",
  departed: "bg-primary/15 text-primary",
  cancelled: "bg-muted text-muted-foreground",
};

export default function MyBookings() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Booking[]>([]);
  const [managing, setManaging] = useState<Booking | null>(null);

  const load = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("bookings")
      .select(
        "id, reference, seat_number, status, trips(origin,destination,departure_at,arrival_at,price_sar, trains(code,name))",
      )
      .eq("passenger_id", profile.id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as Booking[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const cancel = async (id: string) => {
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Booking cancelled — your seat has been released.");
      setManaging(null);
      load();
    }
  };

  const reDownload = (b: Booking) => {
    if (!profile || !b.trips) return;
    downloadReceipt({
      reference: b.reference,
      passengerName: profile.full_name,
      masarId: profile.masar_id,
      trainCode: b.trips.trains?.code ?? "",
      trainName: b.trips.trains?.name ?? "",
      origin: b.trips.origin,
      destination: b.trips.destination,
      departure: b.trips.departure_at,
      arrival: b.trips.arrival_at,
      seatNumber: b.seat_number,
      priceSar: Number(b.trips.price_sar),
    });
  };

  const managingStatus = useMemo(
    () => (managing ? displayStatus(managing) : null),
    [managing],
  );

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <h1 className="mb-6 text-2xl font-semibold">My bookings</h1>

      <div className="grid gap-3">
        {rows.map((b) => {
          const s = displayStatus(b);
          return (
            <Card
              key={b.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium">
                  {b.trips?.origin} → {b.trips?.destination}{" "}
                  <span className="ml-2 text-xs text-muted-foreground">{b.reference}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {b.trips?.trains?.code} ·{" "}
                  {b.trips && format(new Date(b.trips.departure_at), "EEE d MMM, HH:mm")} · Seat #
                  {b.seat_number}
                </div>
                <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs capitalize ${STATUS_STYLE[s]}`}>
                  {s}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setManaging(b)}>
                  Manage booking
                </Button>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && <p className="text-muted-foreground">You have no bookings yet.</p>}
      </div>

      {/* ── Manage booking dialog ─────────────────────────────────── */}
      <Dialog open={!!managing} onOpenChange={(o) => !o && setManaging(null)}>
        <DialogContent className="max-w-md">
          {managing && managing.trips && (
            <>
              <DialogHeader>
                <DialogTitle>Manage booking</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {managing.reference}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs capitalize ${
                      STATUS_STYLE[managingStatus!]
                    }`}
                  >
                    {managingStatus}
                  </span>
                  <span className="text-muted-foreground">Seat #{managing.seat_number}</span>
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <MapPin className="h-4 w-4 text-primary" />
                    {managing.trips.origin} → {managing.trips.destination}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <TrainFront className="h-3 w-3" />
                      {managing.trips.trains?.code} · {managing.trips.trains?.name}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(managing.trips.departure_at), "EEE d MMM, HH:mm")} →{" "}
                      {format(new Date(managing.trips.arrival_at), "HH:mm")}
                    </div>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-foreground">
                    {Number(managing.trips.price_sar).toFixed(2)} SAR
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => reDownload(managing)}>
                  <Download className="mr-1 h-4 w-4" /> Receipt
                </Button>
                {managingStatus === "active" && (
                  <Button variant="destructive" onClick={() => cancel(managing.id)}>
                    <X className="mr-1 h-4 w-4" /> Cancel booking
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
