/**
 * Admin — Trips management (CRUD).
 *
 * Rules enforced client-side (DB has its own constraints as a backup):
 *   - departure must be in the future
 *   - arrival must be after departure
 *   - total_seats cannot be reduced below the number of currently active bookings
 *   - origin/destination must be different
 *
 * Cancelling a trip sets status='cancelled' instead of deleting so the
 * existing bookings keep their reference history.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ADMIN_NAV } from "./nav";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus, Pencil, Ban, Trash2 } from "lucide-react";
import { getTripDisplayStatus, TRIP_STATUS_STYLE, useMinuteNow } from "@/lib/trips";

interface Train { id: string; code: string; name: string; }
interface Trip {
  id: string;
  origin: string;
  destination: string;
  departure_at: string;
  arrival_at: string;
  total_seats: number;
  price_sar: number;
  status: "scheduled" | "departed" | "arrived" | "cancelled";
  train_id: string;
  trains: { code: string; name: string } | null;
}

export default function AdminTrips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [trains, setTrains] = useState<Train[]>([]);
  // Map of trip_id -> active bookings count, used to validate seat reductions.
  const [activeByTrip, setActiveByTrip] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Trip | null>(null);
  const [open, setOpen] = useState(false);
  const now = useMinuteNow();

  const load = async () => {
    const [tripsRes, trainsRes, bookingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, arrival_at, total_seats, price_sar, status, train_id, trains(code,name)")
        .order("departure_at", { ascending: false }),
      supabase.from("trains").select("id, code, name").order("code"),
      supabase.from("bookings").select("trip_id").eq("status", "active"),
    ]);
    setTrips((tripsRes.data ?? []) as Trip[]);
    setTrains((trainsRes.data ?? []) as Train[]);
    const counts: Record<string, number> = {};
    (bookingsRes.data ?? []).forEach((b: any) => {
      counts[b.trip_id] = (counts[b.trip_id] ?? 0) + 1;
    });
    setActiveByTrip(counts);
  };

  useEffect(() => {
    load();
    // Live updates so the booked-seat count stays accurate.
    const channel = supabase
      .channel("admin-trips-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (t: Trip) => { setEditing(t); setOpen(true); };

  /** Mark a trip cancelled; keeps history but releases seats. */
  const cancelTrip = async (t: Trip) => {
    if (!confirm(`Cancel trip ${t.origin} → ${t.destination}? All active bookings will be released.`)) return;
    // 1) cancel trip
    const { error: e1 } = await supabase.from("trips").update({ status: "cancelled" }).eq("id", t.id);
    // 2) cancel its active bookings
    const { error: e2 } = await supabase.from("bookings").update({ status: "cancelled" }).eq("trip_id", t.id).eq("status", "active");
    if (e1 || e2) toast.error((e1 ?? e2)?.message);
    else toast.success("Trip cancelled — bookings released.");
  };

  /** Hard delete — only safe when no bookings have ever existed for this trip. */
  const deleteTrip = async (t: Trip) => {
    if ((activeByTrip[t.id] ?? 0) > 0) {
      toast.error("Cancel the trip instead — it has active bookings.");
      return;
    }
    if (!confirm(`Delete trip ${t.origin} → ${t.destination}? This cannot be undone.`)) return;
    const { error } = await supabase.from("trips").delete().eq("id", t.id);
    if (error) toast.error(error.message);
    else toast.success("Trip deleted.");
  };

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trips</h1>
          <p className="text-sm text-muted-foreground">Create, edit, and cancel scheduled trips.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> New trip</Button>
          </DialogTrigger>
          <TripDialog
            key={editing?.id ?? "new"}
            trip={editing}
            trains={trains}
            activeBookings={editing ? activeByTrip[editing.id] ?? 0 : 0}
            onSaved={() => { setOpen(false); load(); }}
          />
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Train</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">Departure</th>
                <th className="px-4 py-2">Arrival</th>
                <th className="px-4 py-2">Seats</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const effective = getTripDisplayStatus(t, now);
                return (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-2 whitespace-nowrap">{t.trains?.code}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{t.origin} → {t.destination}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{format(new Date(t.departure_at), "yyyy-MM-dd HH:mm")}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{format(new Date(t.arrival_at), "yyyy-MM-dd HH:mm")}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{activeByTrip[t.id] ?? 0} / {t.total_seats}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{Number(t.price_sar).toFixed(2)} SAR</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`rounded px-2 py-0.5 text-xs capitalize ${TRIP_STATUS_STYLE[effective]}`}>{effective}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(t)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {effective === "active" && (
                          <Button size="icon" variant="ghost" onClick={() => cancelTrip(t)} title="Cancel">
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => deleteTrip(t)} title="Delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {trips.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No trips yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}

/* ---------- Create / edit dialog ---------- */

function TripDialog({
  trip,
  trains,
  activeBookings,
  onSaved,
}: {
  trip: Trip | null;
  trains: Train[];
  activeBookings: number;
  onSaved: () => void;
}) {
  // Format Date → value usable by <input type="datetime-local">.
  const toLocal = (iso?: string) =>
    iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";

  // Today (local) as min for date pickers — prevents picking past dates entirely.
  const minDateTime = format(new Date(), "yyyy-MM-dd'T'HH:mm");

  const [trainId, setTrainId]   = useState(trip?.train_id ?? trains[0]?.id ?? "");
  const [origin, setOrigin]     = useState(trip?.origin ?? "");
  const [destination, setDest]  = useState(trip?.destination ?? "");
  const [departure, setDep]     = useState(toLocal(trip?.departure_at));
  const [arrival, setArr]       = useState(toLocal(trip?.arrival_at));
  const [seats, setSeats]       = useState<number>(trip?.total_seats ?? 40);
  const [price, setPrice]       = useState<number>(Number(trip?.price_sar ?? 100));
  const [busy, setBusy]         = useState(false);

  const minSeats = Math.max(1, activeBookings); // can't reduce below booked

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ---- client-side validation (DB has constraints too) ----
    if (!trainId) return toast.error("Pick a train.");
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase())
      return toast.error("Origin and destination must differ.");
    const dep = new Date(departure), arr = new Date(arrival);
    if (isNaN(+dep) || isNaN(+arr)) return toast.error("Invalid dates.");
    if (!trip && dep.getTime() <= Date.now())
      return toast.error("Departure must be in the future.");
    if (arr <= dep) return toast.error("Arrival must be after departure.");
    if (seats < minSeats)
      return toast.error(`Cannot reduce seats below ${minSeats} (active bookings).`);
    if (price <= 0) return toast.error("Price must be greater than zero.");

    setBusy(true);
    const payload = {
      train_id: trainId,
      origin: origin.trim(),
      destination: destination.trim(),
      departure_at: dep.toISOString(),
      arrival_at: arr.toISOString(),
      total_seats: seats,
      price_sar: price,
    };
    const { error } = trip
      ? await supabase.from("trips").update(payload).eq("id", trip.id)
      : await supabase.from("trips").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(trip ? "Trip updated." : "Trip created."); onSaved(); }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{trip ? "Edit trip" : "New trip"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Train</Label>
          <Select value={trainId} onValueChange={setTrainId}>
            <SelectTrigger><SelectValue placeholder="Select a train" /></SelectTrigger>
            <SelectContent>
              {trains.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Origin</Label>
            <Input value={origin} onChange={(e) => setOrigin(e.target.value)} required />
          </div>
          <div>
            <Label>Destination</Label>
            <Input value={destination} onChange={(e) => setDest(e.target.value)} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Departure</Label>
            <Input type="datetime-local" min={trip ? undefined : minDateTime} value={departure} onChange={(e) => setDep(e.target.value)} required />
          </div>
          <div>
            <Label>Arrival</Label>
            <Input type="datetime-local" min={departure || minDateTime} value={arrival} onChange={(e) => setArr(e.target.value)} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Total seats {trip && activeBookings > 0 && <span className="text-xs text-muted-foreground">(min {minSeats})</span>}</Label>
            <Input type="number" min={minSeats} value={seats} onChange={(e) => setSeats(Number(e.target.value))} required />
          </div>
          <div>
            <Label>Price (SAR)</Label>
            <Input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : (trip ? "Save changes" : "Create trip")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
