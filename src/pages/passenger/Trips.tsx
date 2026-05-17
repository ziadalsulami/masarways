/**
 * Passenger — Browse upcoming trips and book one or more seats.
 *
 * A single passenger may now book multiple seats on the same trip (adults
 * and/or kids). All seats are stored under the booker's profile so they can
 * be managed from one place. Each seat is still its own row in the bookings
 * table (with its own reference) so cancellations / seat-map state stay
 * simple — but at purchase time a single combined PDF receipt is produced.
 *
 * Pricing rule (UI + receipt):
 *   - Adult ticket = full trip price
 *   - Kid ticket   = 50% of the trip price
 *
 * Live updates:
 *   Realtime subscription on `bookings` keeps the seat map in sync across
 *   all connected clients (taken seats appear immediately).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import { format } from "date-fns";
import { downloadReceipt } from "@/lib/pdf";
import { TrainFront, CreditCard, CheckCircle2, Minus, Plus } from "lucide-react";
import appleLogo from "@/assets/apple-pay-logo.png";
import Greeting from "@/components/Greeting";
import SeatMap from "@/components/SeatMap";
import { isActiveTrip, useMinuteNow } from "@/lib/trips";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Trip {
  id: string;
  origin: string;
  destination: string;
  departure_at: string;
  arrival_at: string;
  total_seats: number;
  price_sar: number;
  status: "scheduled" | "departed" | "arrived" | "cancelled";
  trains: { code: string; name: string } | null;
}

interface BookingLite {
  trip_id: string;
  seat_number: number;
  passenger_id: string;
}

const KID_DISCOUNT = 0.5;
/** Hard cap on tickets per checkout — keeps the UI sensible. */
const MAX_TICKETS = 8;

export default function PassengerTrips() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [bookings, setBookings] = useState<BookingLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Multi-seat selection state.
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [chosenSeats, setChosenSeats] = useState<Set<number>>(new Set());
  const [booking, setBooking] = useState(false);

  const [filterDest, setFilterDest] = useState<string>("");
  const [filterDate, setFilterDate] = useState<string>(""); // yyyy-mm-dd

  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "apple_pay">("card");
  const [paying, setPaying] = useState(false);
  const now = useMinuteNow();

  const loadAll = async () => {
    const nowIso = new Date().toISOString();
    const [tripsRes, bookingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, arrival_at, total_seats, price_sar, status, trains(code,name)")
        .gte("departure_at", nowIso)
        .eq("status", "scheduled")
        .order("departure_at", { ascending: true }),
      supabase
        .from("bookings")
        .select("trip_id, seat_number, passenger_id")
        .eq("status", "active"),
    ]);
    setTrips((tripsRes.data ?? []) as Trip[]);
    setBookings((bookingsRes.data ?? []) as BookingLite[]);
  };

  useEffect(() => {
    if (!profile) return;
    loadAll();
    const channel = supabase
      .channel("bookings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Derived: taken seats per trip + which seats this user already booked.
  const { takenByTrip, ownSeatsByTrip } = useMemo(() => {
    const taken: Record<string, Set<number>> = {};
    const own: Record<string, Set<number>> = {};
    bookings.forEach((b) => {
      (taken[b.trip_id] ||= new Set()).add(b.seat_number);
      if (b.passenger_id === profile?.id) {
        (own[b.trip_id] ||= new Set()).add(b.seat_number);
      }
    });
    return { takenByTrip: taken, ownSeatsByTrip: own };
  }, [bookings, profile?.id]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const visibleTrips = useMemo(() => {
    const q = filterDest.trim().toLowerCase();
    return trips.filter((t) => {
      if (!isActiveTrip(t, now)) return false;
      const taken = takenByTrip[t.id]?.size ?? 0;
      if (taken >= t.total_seats) return false;
      if (q && q !== "all" && !t.destination.toLowerCase().includes(q)) return false;
      if (filterDate) {
        const tripDay = new Date(t.departure_at).toISOString().slice(0, 10);
        if (tripDay !== filterDate) return false;
      }
      return true;
    });
  }, [trips, filterDest, filterDate, takenByTrip, now]);

  const destinations = useMemo(
    () => Array.from(new Set(trips.map((t) => t.destination))).sort(),
    [trips],
  );

  const selected =
    visibleTrips.find((t) => t.id === selectedId) ?? trips.find((t) => t.id === selectedId) ?? null;

  // Reset selection state whenever the modal opens for a new trip.
  useEffect(() => {
    setChosenSeats(new Set());
    setAdults(1);
    setKids(0);
  }, [selectedId]);

  const totalTickets = adults + kids;

  // Cap tickets by what's actually left on this trip.
  const seatsLeftOnSelected = selected
    ? selected.total_seats - (takenByTrip[selected.id]?.size ?? 0)
    : 0;
  const ticketCap = Math.max(1, Math.min(MAX_TICKETS, seatsLeftOnSelected));

  // Auto-trim chosen seats if the user reduces ticket count.
  useEffect(() => {
    if (chosenSeats.size > totalTickets) {
      const trimmed = [...chosenSeats].slice(0, totalTickets);
      setChosenSeats(new Set(trimmed));
    }
  }, [totalTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSeat = (n: number) => {
    setChosenSeats((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else if (next.size < totalTickets) next.add(n);
      return next;
    });
  };

  const totalPrice = selected
    ? adults * Number(selected.price_sar) + kids * Number(selected.price_sar) * KID_DISCOUNT
    : 0;

  const newReference = () =>
    "MSR-" +
    Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "X");

  // Step 1 — seat selection done, open the review + payment dialog.
  const openPayment = () => {
    if (!selected || chosenSeats.size === 0) return;
    if (chosenSeats.size !== totalTickets) {
      toast.error(`Please pick exactly ${totalTickets} seat${totalTickets === 1 ? "" : "s"}.`);
      return;
    }
    if (!isActiveTrip(selected, Date.now())) {
      toast.error("This trip has already departed and can no longer be booked.");
      loadAll();
      setSelectedId(null);
      return;
    }
    setPayMethod("card");
    setPayOpen(true);
  };

  // Step 2 — mock payment, insert one booking row per seat under the same
  // passenger, then download a combined receipt PDF for the whole group.
  const payAndBook = async () => {
    if (!selected || !profile || chosenSeats.size === 0) return;
    if (!isActiveTrip(selected, Date.now())) {
      toast.error("This trip has already departed and can no longer be booked.");
      setPayOpen(false);
      await loadAll();
      setSelectedId(null);
      return;
    }
    setPaying(true);
    await new Promise((r) => setTimeout(r, 900)); // mock processing

    const seatList = [...chosenSeats].sort((a, b) => a - b);
    const rows = seatList.map((seat_number) => ({
      reference: newReference(),
      trip_id: selected.id,
      passenger_id: profile.id,
      seat_number,
    }));

    const { error } = await supabase.from("bookings").insert(rows);

    if (error) {
      setPaying(false);
      if (error.code === "23505") {
        toast.error("One of those seats was just taken. Please pick again.");
        await loadAll();
        setChosenSeats(new Set());
        setPayOpen(false);
      } else {
        toast.error(error.message);
      }
      return;
    }

    // One combined receipt covers the whole purchase.
    downloadReceipt({
      reference: rows[0].reference,
      passengerName: profile.full_name,
      masarId: profile.masar_id,
      trainCode: selected.trains?.code ?? "",
      trainName: selected.trains?.name ?? "",
      origin: selected.origin,
      destination: selected.destination,
      departure: selected.departure_at,
      arrival: selected.arrival_at,
      seatNumbers: seatList,
      adults,
      kids,
      priceSar: Number(selected.price_sar),
    });

    toast.success(
      `Payment successful via ${payMethod === "card" ? "Card" : "Apple Pay"} — ${seatList.length} seat${
        seatList.length === 1 ? "" : "s"
      } booked.`,
    );
    setPaying(false);
    setPayOpen(false);
    navigate(`/app/confirmation/${rows[0].reference}`);
  };

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <Greeting subtitle="Find your next train ride and reserve seats in seconds." />
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Upcoming trips</h1>
          <p className="text-sm text-muted-foreground">
            Live seat availability — updates instantly when others book or cancel.
          </p>
        </div>
        <span className="hidden items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live
        </span>
      </div>

      {/* ── Search filters ───────────────────────────────────────── */}
      <div className="mb-5 grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Where to?</label>
          <input
            list="trip-destinations"
            value={filterDest}
            onChange={(e) => setFilterDest(e.target.value)}
            placeholder="Search destination…"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
          <datalist id="trip-destinations">
            {destinations.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            min={todayStr}
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setFilterDest("");
            setFilterDate("");
          }}
          className="h-9 self-end rounded-md border border-border bg-background px-3 text-sm hover:bg-accent"
        >
          Reset
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTrips.map((t) => {
          const seatsTaken = takenByTrip[t.id]?.size ?? 0;
          const seatsLeft = t.total_seats - seatsTaken;
          const pct = (seatsTaken / t.total_seats) * 100;
          const ownCount = ownSeatsByTrip[t.id]?.size ?? 0;
          return (
            <div
              key={t.id}
              className="group rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  {t.origin} → {t.destination}
                </div>
                <div className="text-sm font-semibold">{Number(t.price_sar).toFixed(2)} SAR</div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <TrainFront className="h-3 w-3" />
                {t.trains?.code} · {format(new Date(t.departure_at), "EEE d MMM, HH:mm")}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {seatsLeft} of {t.total_seats} available
                </span>
                {ownCount > 0 && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                    {ownCount} of yours
                  </span>
                )}
              </div>
              <div className="mt-3">
                <button
                  onClick={() => setSelectedId(t.id)}
                  className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  {ownCount > 0 ? "Book more seats" : "Book seats"}
                </button>
              </div>
            </div>
          );
        })}
        {visibleTrips.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            {trips.length === 0
              ? "No upcoming trips at the moment."
              : "No trips were found for your search — try a different destination or date."}
          </div>
        )}
      </div>

      {/* Seat-picker modal: ticket counters + seat map. */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.origin} → {selected.destination}
                </DialogTitle>
                <DialogDescription>
                  {selected.trains?.code} · {selected.trains?.name} ·{" "}
                  {format(new Date(selected.departure_at), "EEE d MMM, HH:mm")} →{" "}
                  {format(new Date(selected.arrival_at), "HH:mm")} ·{" "}
                  <span className="font-semibold text-foreground">
                    {Number(selected.price_sar).toFixed(2)} SAR / adult
                  </span>{" "}
                  · {seatsLeftOnSelected} left
                </DialogDescription>
              </DialogHeader>

              {/* Ticket counters */}
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Tickets</div>
                  <div className="text-xs text-muted-foreground">
                    Kids ride at 50% · max {ticketCap}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Counter
                    label="Adults"
                    sub={`${Number(selected.price_sar).toFixed(2)} SAR`}
                    value={adults}
                    onDec={() => setAdults((a) => Math.max(1, a - 1))}
                    onInc={() => {
                      if (totalTickets < ticketCap) setAdults((a) => a + 1);
                    }}
                    minDisabled={adults <= 1}
                    maxDisabled={totalTickets >= ticketCap}
                  />
                  <Counter
                    label="Kids"
                    sub={`${(Number(selected.price_sar) * KID_DISCOUNT).toFixed(2)} SAR`}
                    value={kids}
                    onDec={() => setKids((k) => Math.max(0, k - 1))}
                    onInc={() => {
                      if (totalTickets < ticketCap) setKids((k) => k + 1);
                    }}
                    minDisabled={kids <= 0}
                    maxDisabled={totalTickets >= ticketCap}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">
                    {totalTickets} ticket{totalTickets === 1 ? "" : "s"} · pick {totalTickets} seat
                    {totalTickets === 1 ? "" : "s"}
                  </span>
                  <span className="font-semibold">{totalPrice.toFixed(2)} SAR</span>
                </div>
              </div>

              <SeatMap
                totalSeats={selected.total_seats}
                taken={takenByTrip[selected.id] ?? new Set()}
                ownSeats={ownSeatsByTrip[selected.id]}
                chosen={chosenSeats}
                onToggle={toggleSeat}
                maxSelectable={totalTickets}
                onConfirm={openPayment}
                busy={booking || paying}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment-method dialog */}
      <Dialog
        open={payOpen}
        onOpenChange={(open) => {
          if (!paying) setPayOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review & pay</DialogTitle>
            <DialogDescription>
              Confirm your booking details and choose a payment method.
            </DialogDescription>
          </DialogHeader>

          {selected && chosenSeats.size > 0 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <Row label="Route" value={`${selected.origin} → ${selected.destination}`} />
                <Row
                  label="Train"
                  value={`${selected.trains?.code ?? ""} · ${selected.trains?.name ?? ""}`}
                />
                <Row
                  label="Departure"
                  value={format(new Date(selected.departure_at), "EEE d MMM, HH:mm")}
                />
                <Row
                  label="Arrival"
                  value={format(new Date(selected.arrival_at), "EEE d MMM, HH:mm")}
                />
                <Row
                  label="Seats"
                  value={[...chosenSeats]
                    .sort((a, b) => a - b)
                    .map((n) => `#${n}`)
                    .join(", ")}
                />
                <Row label="Passenger" value={profile?.full_name ?? ""} />
                <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>
                      Adults × {adults} @ {Number(selected.price_sar).toFixed(2)} SAR
                    </span>
                    <span>{(adults * Number(selected.price_sar)).toFixed(2)} SAR</span>
                  </div>
                  <div className="flex justify-between">
                    <span>
                      Kids × {kids} @ {(Number(selected.price_sar) * KID_DISCOUNT).toFixed(2)} SAR
                    </span>
                    <span>
                      {(kids * Number(selected.price_sar) * KID_DISCOUNT).toFixed(2)} SAR
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">{totalPrice.toFixed(2)} SAR</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Payment method</div>
                <div className="grid grid-cols-2 gap-2">
                  <PayMethodCard
                    active={payMethod === "card"}
                    onClick={() => setPayMethod("card")}
                    icon={<CreditCard className="h-5 w-5" />}
                    label="Card"
                    sub="Visa · Mastercard · mada"
                  />
                  <PayMethodCard
                    active={payMethod === "apple_pay"}
                    onClick={() => setPayMethod("apple_pay")}
                    icon={
                      <img
                        src={appleLogo}
                        alt="Apple Pay"
                        className="h-5 w-5 object-contain dark:invert"
                      />
                    }
                    label="Apple Pay"
                    sub="Pay with Touch / Face ID"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Demo mode — no real charge is made.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={payAndBook} disabled={paying}>
              {paying ? (
                "Processing…"
              ) : (
                <>
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  Pay {totalPrice.toFixed(2)} SAR
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-right text-sm">{value}</span>
    </div>
  );
}

/** +/- counter used for adults & kids ticket selection. */
function Counter({
  label,
  sub,
  value,
  onDec,
  onInc,
  minDisabled,
  maxDisabled,
}: {
  label: string;
  sub: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  minDisabled: boolean;
  maxDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onDec}
          disabled={minDisabled}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-5 text-center text-sm font-semibold">{value}</span>
        <button
          type="button"
          onClick={onInc}
          disabled={maxDisabled}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function PayMethodCard({
  active,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
        active
          ? "border-primary bg-primary/5 ring-2 ring-primary/40"
          : "border-border bg-card hover:border-primary/50"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </button>
  );
}
