/**
 * Passenger — Browse upcoming trips and book a seat.
 *
 * Layout:
 *   - left: list of upcoming trips, each card highlights selection
 *   - right: live seat map of the selected trip with a legend
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
 *   - cannot book more seats than exist → guarded before insert
 *   - one active booking per (trip, passenger) → DB unique index
 *   - no seat double-booking            → DB unique index
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { downloadReceipt } from "@/lib/pdf";
import { TrainFront } from "lucide-react";

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

  /** Fetch trips + active bookings. Called on mount + on every Realtime event. */
  const loadAll = async () => {
    const nowIso = new Date().toISOString();
    const [tripsRes, bookingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, arrival_at, total_seats, price_sar, trains(code,name)")
        .gte("departure_at", nowIso)
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

    // Listens to all changes (insert/update/delete) on bookings and
    // refreshes the local state. Cheap because the table is small.
    const channel = supabase
      .channel("bookings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => loadAll())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Auto-select the first trip when trips first load.
  useEffect(() => {
    if (!selectedId && trips.length) setSelectedId(trips[0].id);
  }, [trips, selectedId]);

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

  const selected = trips.find((t) => t.id === selectedId) ?? null;

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

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,1.2fr)]">
        {/* LEFT — trip list */}
        <div className="grid content-start gap-3">
          {trips.map((t) => {
            const seatsTaken = takenByTrip[t.id]?.size ?? 0;
            const seatsLeft = t.total_seats - seatsTaken;
            const pct = (seatsTaken / t.total_seats) * 100;
            const isSelected = t.id === selectedId;
            const alreadyBooked = mineByTrip.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`group rounded-lg border p-4 text-left transition ${
                  isSelected
                    ? "border-primary bg-accent/40 shadow-sm"
                    : "border-border bg-card hover:border-primary/40"
                }`}
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
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
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
          {trips.length === 0 && (
            <p className="text-muted-foreground">No upcoming trips at the moment.</p>
          )}
        </div>

        {/* RIGHT — live seat map */}
        <Card className="p-5">
          {!selected ? (
            <p className="text-muted-foreground">Select a trip to view its seat map.</p>
          ) : (
            <SeatMap
              trip={selected}
              taken={takenByTrip[selected.id] ?? new Set()}
              ownSeat={ownSeatByTrip[selected.id]}
              chosen={chosenSeat}
              onChoose={setChosenSeat}
              alreadyBooked={mineByTrip.has(selected.id)}
              onConfirm={confirmBooking}
              busy={booking}
            />
          )}
        </Card>
      </div>
    </AppShell>
  );
}

/**
 * Visual seat map — pure presentation. All state lives in the parent.
 * Seats are coloured by status:
 *   - taken     → muted, struck through
 *   - your seat → primary border (you can't book again)
 *   - chosen    → solid primary
 *   - free      → outlined, hover hint
 */
function SeatMap({
  trip,
  taken,
  ownSeat,
  chosen,
  onChoose,
  alreadyBooked,
  onConfirm,
  busy,
}: {
  trip: Trip;
  taken: Set<number>;
  ownSeat?: number;
  chosen: number | null;
  onChoose: (n: number) => void;
  alreadyBooked: boolean;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="font-medium">
            {trip.origin} → {trip.destination}
          </div>
          <div className="text-xs text-muted-foreground">
            {trip.trains?.code} · {trip.trains?.name} ·{" "}
            {format(new Date(trip.departure_at), "EEE d MMM, HH:mm")} →{" "}
            {format(new Date(trip.arrival_at), "HH:mm")}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{Number(trip.price_sar).toFixed(2)} SAR</div>
          <div className="text-xs text-muted-foreground">{trip.total_seats - taken.size} left</div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Legend className="border border-border bg-background" label="Available" />
        <Legend className="bg-primary text-primary-foreground" label="Selected" />
        <Legend className="border border-primary bg-primary/10" label="Your seat" />
        <Legend className="bg-muted text-muted-foreground line-through" label="Taken" />
      </div>

      {/* Seat grid */}
      <div className="grid grid-cols-8 gap-2 sm:grid-cols-10">
        {Array.from({ length: trip.total_seats }, (_, i) => i + 1).map((n) => {
          const isOwn = ownSeat === n;
          const isTaken = taken.has(n) && !isOwn;
          const isChosen = chosen === n;
          return (
            <button
              key={n}
              disabled={isTaken || alreadyBooked}
              onClick={() => onChoose(n)}
              title={isTaken ? "Taken" : isOwn ? "Your seat" : `Seat ${n}`}
              className={`h-9 rounded text-xs transition ${
                isTaken
                  ? "cursor-not-allowed bg-muted text-muted-foreground line-through"
                  : isOwn
                  ? "border border-primary bg-primary/10 text-primary"
                  : isChosen
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-background hover:border-primary hover:bg-accent/40"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <div className="text-sm">
          {alreadyBooked ? (
            <span className="text-muted-foreground">
              You already booked this trip (seat #{ownSeat}).
            </span>
          ) : (
            <span>
              Selected seat: <strong>{chosen ?? "—"}</strong>
            </span>
          )}
        </div>
        <Button onClick={onConfirm} disabled={!chosen || busy || alreadyBooked}>
          {busy ? "Booking…" : "Confirm booking"}
        </Button>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${className}`} /> {label}
    </span>
  );
}
