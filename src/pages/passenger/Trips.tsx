/**
 * Passenger — Browse upcoming trips and book a seat.
 *
 * Layout:
 *   - left: list of upcoming trips, each card highlights selection
 *   - right: live train-carriage seat map of the selected trip
 *
 * Live updates:
 *   We subscribe to Postgres changes on public.bookings via Supabase
 *   Realtime. Any insert / update (cancellation) refetches the booking
 *   set so the seat map reflects reality across all connected clients.
 *
 * The booking flow enforces every rule the spec asks for, BOTH on the
 * client (for fast feedback) and via DB constraints (the source of truth):
 *   - cannot book trips in the past   → query filters out past departures
 *   - cannot pick a taken seat        → seat list excludes active bookings
 *   - cannot book more seats than exist → guarded by total_seats grid
 *   - one active booking per (trip, passenger) → DB unique index
 *   - no seat double-booking            → DB unique index
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { toast } from "sonner";
import { format } from "date-fns";
import { downloadReceipt } from "@/lib/pdf";
import { TrainFront, CreditCard, Apple, CheckCircle2 } from "lucide-react";
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

export default function PassengerTrips() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // Trips visible in the left list (future, scheduled).
  const [trips, setTrips] = useState<Trip[]>([]);
  // Active bookings — the source of truth for which seats are taken.
  const [bookings, setBookings] = useState<BookingLite[]>([]);
  // Currently selected trip + chosen seat (right pane).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosenSeat, setChosenSeat] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);

  // ── Search filters ────────────────────────────────────────────────
  // The passenger picks an optional destination + earliest date. When set,
  // we filter the trips list client-side so the UX stays instant.
  const [filterDest, setFilterDest] = useState<string>("");
  const [filterDate, setFilterDate] = useState<string>(""); // yyyy-mm-dd
  // Payment step state — after picking a seat, the user reviews booking
  // details and selects a (mock) payment method before confirmation.
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "apple_pay">("card");
  const [paying, setPaying] = useState(false);
  const now = useMinuteNow();

  /** Fetch trips + active bookings. Called on mount + on every Realtime event. */
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

  // Initial load + Realtime subscription on bookings.
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

  // The seat-picker modal opens whenever a trip is selected. Closing it
  // (via overlay click or close button) clears the selection so the user is
  // back to the trip list without scrolling.

  // Derived: taken seats per trip + which trips this user actively booked.
  const { takenByTrip, mineByTrip, ownSeatByTrip } = useMemo(() => {
    const taken: Record<string, Set<number>> = {};
    const mine = new Set<string>();
    const ownSeat: Record<string, number> = {};
    bookings.forEach((b) => {
      (taken[b.trip_id] ||= new Set()).add(b.seat_number);
      if (b.passenger_id === profile?.id) {
        mine.add(b.trip_id);
        ownSeat[b.trip_id] = b.seat_number;
      }
    });
    return { takenByTrip: taken, mineByTrip: mine, ownSeatByTrip: ownSeat };
  }, [bookings, profile?.id]);

  // Today (local) yyyy-mm-dd — used as the min for the date filter so users
  // physically cannot select a past date.
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Apply search filters: hide fully-booked trips, match destination (substring,
  // case-insensitive), and require an exact date match when one is picked.
  const visibleTrips = useMemo(() => {
    const q = filterDest.trim().toLowerCase();
    return trips.filter((t) => {
      if (!isActiveTrip(t, now)) return false;
      // Hide fully-booked trips entirely from the passenger view.
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

  // Distinct destination options for the datalist autocomplete.
  const destinations = useMemo(
    () => Array.from(new Set(trips.map((t) => t.destination))).sort(),
    [trips],
  );

  const selected = visibleTrips.find((t) => t.id === selectedId) ?? trips.find((t) => t.id === selectedId) ?? null;

  // Reset the chosen seat whenever the selected trip changes.
  useEffect(() => setChosenSeat(null), [selectedId]);

  const newReference = () =>
    "MSR-" +
    Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "X");

  // Step 1 — user clicked "Confirm" in the seat map. We don't book yet;
  // we open the booking-review + payment-method dialog.
  const openPayment = () => {
    if (!selected || !chosenSeat) return;
    if (!isActiveTrip(selected, Date.now())) {
      toast.error("This trip has already departed and can no longer be booked.");
      loadAll();
      setSelectedId(null);
      return;
    }
    setPayMethod("card");
    setPayOpen(true);
  };

  // Step 2 — user picked a payment method. We run a short mock "processing"
  // delay (no real payment fields), then insert the booking and download the
  // receipt PDF.
  const payAndBook = async () => {
    if (!selected || !chosenSeat || !profile) return;
    if (!isActiveTrip(selected, Date.now())) {
      toast.error("This trip has already departed and can no longer be booked.");
      setPayOpen(false);
      await loadAll();
      setSelectedId(null);
      return;
    }
    setPaying(true);
    // Mock payment processing — visual delay only, no card details collected.
    await new Promise((r) => setTimeout(r, 900));

    const reference = newReference();
    const { error } = await supabase.from("bookings").insert({
      reference,
      trip_id: selected.id,
      passenger_id: profile.id,
      seat_number: chosenSeat,
    });

    if (error) {
      setPaying(false);
      if (error.code === "23505") {
        toast.error("That seat was just taken or you already booked this trip.");
        await loadAll();
        setPayOpen(false);
      } else {
        toast.error(error.message);
      }
      return;
    }

    downloadReceipt({
      reference,
      passengerName: profile.full_name,
      masarId: profile.masar_id,
      trainCode: selected.trains?.code ?? "",
      trainName: selected.trains?.name ?? "",
      origin: selected.origin,
      destination: selected.destination,
      departure: selected.departure_at,
      arrival: selected.arrival_at,
      seatNumber: chosenSeat,
      priceSar: Number(selected.price_sar),
    });

    toast.success(`Payment successful via ${payMethod === "card" ? "Card" : "Apple Pay"}`);
    setPaying(false);
    setPayOpen(false);
    navigate(`/app/confirmation/${reference}`);
  };

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <Greeting subtitle="Find your next train ride and reserve a seat in seconds." />
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
      {/* Searchable destination input (with autocomplete suggestions) and an
          exact date picker. Past dates are blocked at the input level. */}
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

      {/* Trip list — full-width grid of cards. Clicking a card opens a centered
          modal with the live seat map, so the user never needs to scroll to see
          availability. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTrips.map((t) => {
          const seatsTaken = takenByTrip[t.id]?.size ?? 0;
          const seatsLeft = t.total_seats - seatsTaken;
          const pct = (seatsTaken / t.total_seats) * 100;
          const alreadyBooked = mineByTrip.has(t.id);
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
              {/* Capacity bar */}
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {seatsLeft} of {t.total_seats} available
                </span>
                {alreadyBooked && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                    Your seat #{ownSeatByTrip[t.id]}
                  </span>
                )}
              </div>
              {/* Action button */}
              <div className="mt-3">
                {alreadyBooked ? (
                  <button
                    onClick={() => navigate("/app/bookings")}
                    className="inline-flex w-full items-center justify-center rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
                  >
                    Manage booking
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setChosenSeat(null);
                      setSelectedId(t.id);
                    }}
                    className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                  >
                    Book a seat
                  </button>
                )}
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

      {/* Centered seat-picker modal — opens automatically when a trip is selected. */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setChosenSeat(null);
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
                    {Number(selected.price_sar).toFixed(2)} SAR
                  </span>{" "}
                  · {selected.total_seats - (takenByTrip[selected.id]?.size ?? 0)} left
                </DialogDescription>
              </DialogHeader>
              <SeatMap
                totalSeats={selected.total_seats}
                taken={takenByTrip[selected.id] ?? new Set()}
                ownSeat={ownSeatByTrip[selected.id]}
                chosen={chosenSeat}
                onChoose={setChosenSeat}
                alreadyBooked={mineByTrip.has(selected.id)}
                onConfirm={openPayment}
                busy={booking || paying}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment-method dialog — shown after the seat is picked. Mock payment:
          no card details are collected, but the user must choose a method. */}
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

          {selected && chosenSeat && (
            <div className="space-y-4">
              {/* Booking summary */}
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
                <Row label="Seat" value={`#${chosenSeat}`} />
                <Row label="Passenger" value={profile?.full_name ?? ""} />
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">
                    {Number(selected.price_sar).toFixed(2)} SAR
                  </span>
                </div>
              </div>

              {/* Payment method picker */}
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
                    icon={<Apple className="h-5 w-5" />}
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
                  Pay {selected ? Number(selected.price_sar).toFixed(2) : ""} SAR
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
