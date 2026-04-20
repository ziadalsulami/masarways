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
import { TrainFront } from "lucide-react";
import SeatMap from "@/components/SeatMap";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const [filterDest, setFilterDest] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>(""); // yyyy-mm-dd

  /** Fetch trips + active bookings. Called on mount + on every Realtime event. */
  const loadAll = async () => {
    const nowIso = new Date().toISOString();
    const [tripsRes, bookingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, arrival_at, total_seats, price_sar, trains(code,name)")
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

  // Apply search filters (destination + earliest date) to the trips list.
  const visibleTrips = useMemo(() => {
    return trips.filter((t) => {
      if (filterDest !== "all" && t.destination !== filterDest) return false;
      if (filterDate) {
        // Compare on the user's local date (yyyy-mm-dd) for a friendly match.
        const tripDay = new Date(t.departure_at).toISOString().slice(0, 10);
        if (tripDay < filterDate) return false;
      }
      return true;
    });
  }, [trips, filterDest, filterDate]);

  // Distinct destination options for the dropdown.
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

  const confirmBooking = async () => {
    if (!selected || !chosenSeat || !profile) return;
    setBooking(true);
    const reference = newReference();

    const { error } = await supabase.from("bookings").insert({
      reference,
      trip_id: selected.id,
      passenger_id: profile.id,
      seat_number: chosenSeat,
    });
    setBooking(false);

    if (error) {
      // 23505 = unique violation (seat just taken OR same trip already booked).
      if (error.code === "23505") {
        toast.error("That seat was just taken or you already booked this trip.");
        await loadAll();
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

    navigate(`/app/confirmation/${reference}`);
  };

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
        { to: "/account", label: "My account" },
      ]}
    >
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
      {/* Simple filter bar: pick a destination + earliest departure date. */}
      <div className="mb-5 grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Where to?</label>
          <select
            value={filterDest}
            onChange={(e) => setFilterDest(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="all">Any destination</option>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From date</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setFilterDest("all");
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
            <button
              key={t.id}
              onClick={() => {
                setChosenSeat(null);
                setSelectedId(t.id);
              }}
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
            </button>
          );
        })}
        {visibleTrips.length === 0 && (
          <p className="text-muted-foreground sm:col-span-2 lg:col-span-3">
            {trips.length === 0
              ? "No upcoming trips at the moment."
              : "No trips match your search — try a different destination or date."}
          </p>
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
                onConfirm={confirmBooking}
                busy={booking}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
