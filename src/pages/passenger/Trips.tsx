/**
 * Passenger — Browse upcoming trips and book a seat.
 *
 * The booking flow enforces every rule the spec asks for, BOTH on the
 * client (for fast feedback) and via DB constraints (the source of truth):
 *   - cannot book trips in the past   → query filters out past departures
 *   - cannot pick a taken seat        → seat list excludes active bookings
 *   - cannot book more seats than exist → guarded before insert
 *   - one active booking per (trip, passenger) → DB unique index
 *   - no seat double-booking            → DB unique index
 *
 * On success we generate a PDF receipt and route to the confirmation page.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { downloadReceipt } from "@/lib/pdf";

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

export default function PassengerTrips() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  // trip.id → set of seat numbers currently taken (active bookings only)
  const [taken, setTaken] = useState<Record<string, Set<number>>>({});
  // trip.id → set of trip ids the user already actively booked (to disable button)
  const [myActive, setMyActive] = useState<Set<string>>(new Set());

  const [openTrip, setOpenTrip] = useState<Trip | null>(null);
  const [chosenSeat, setChosenSeat] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);

  // Loads (or reloads) trips + which seats are taken + my own active bookings.
  const load = async () => {
    const nowIso = new Date().toISOString();
    const [tripsRes, bookingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, origin, destination, departure_at, arrival_at, total_seats, price_sar, trains(code,name)")
        .gte("departure_at", nowIso)
        .order("departure_at", { ascending: true }),
      supabase.from("bookings").select("trip_id, seat_number, passenger_id, status").eq("status", "active"),
    ]);

    const map: Record<string, Set<number>> = {};
    const mine = new Set<string>();
    (bookingsRes.data ?? []).forEach((b: any) => {
      if (!map[b.trip_id]) map[b.trip_id] = new Set();
      map[b.trip_id].add(b.seat_number);
      if (b.passenger_id === profile?.id) mine.add(b.trip_id);
    });
    setTrips((tripsRes.data ?? []) as Trip[]);
    setTaken(map);
    setMyActive(mine);
  };

  useEffect(() => {
    if (profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  /** Generates a short uppercase booking reference like MSR-AB12CD. */
  const newReference = () =>
    "MSR-" +
    Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "X");

  const confirmBooking = async () => {
    if (!openTrip || !chosenSeat || !profile) return;
    setBooking(true);
    const reference = newReference();

    // Insert; DB uniqueness will reject any race condition.
    const { error } = await supabase.from("bookings").insert({
      reference,
      trip_id: openTrip.id,
      passenger_id: profile.id,
      seat_number: chosenSeat,
    });

    setBooking(false);
    if (error) {
      // Surface friendly messages for the most likely conflicts.
      if (error.code === "23505") {
        toast.error("That seat was just taken or you already booked this trip.");
        await load();
      } else {
        toast.error(error.message);
      }
      return;
    }

    // Build + download the PDF receipt, then jump to the confirmation page.
    downloadReceipt({
      reference,
      passengerName: profile.full_name,
      masarId: profile.masar_id,
      trainCode: openTrip.trains?.code ?? "",
      trainName: openTrip.trains?.name ?? "",
      origin: openTrip.origin,
      destination: openTrip.destination,
      departure: openTrip.departure_at,
      arrival: openTrip.arrival_at,
      seatNumber: chosenSeat,
      priceSar: Number(openTrip.price_sar),
    });

    setOpenTrip(null);
    setChosenSeat(null);
    navigate(`/app/confirmation/${reference}`);
  };

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <h1 className="mb-6 text-2xl font-semibold">Upcoming trips</h1>

      <div className="grid gap-3">
        {trips.map((t) => {
          const seatsTaken = taken[t.id]?.size ?? 0;
          const seatsLeft = t.total_seats - seatsTaken;
          const alreadyBooked = myActive.has(t.id);
          return (
            <Card key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">
                  {t.origin} → {t.destination}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t.trains?.code} · {t.trains?.name} ·{" "}
                  {format(new Date(t.departure_at), "EEE d MMM, HH:mm")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {seatsLeft} of {t.total_seats} seats available
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-lg font-semibold">{Number(t.price_sar).toFixed(2)} SAR</div>
                </div>
                <Button
                  disabled={seatsLeft <= 0 || alreadyBooked}
                  onClick={() => {
                    setOpenTrip(t);
                    setChosenSeat(null);
                  }}
                >
                  {alreadyBooked ? "Already booked" : seatsLeft <= 0 ? "Sold out" : "Book"}
                </Button>
              </div>
            </Card>
          );
        })}
        {trips.length === 0 && (
          <p className="text-muted-foreground">No upcoming trips at the moment.</p>
        )}
      </div>

      {/* Seat picker dialog */}
      <Dialog open={!!openTrip} onOpenChange={(o) => !o && setOpenTrip(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a seat</DialogTitle>
          </DialogHeader>
          {openTrip && (
            <>
              <p className="text-sm text-muted-foreground">
                {openTrip.origin} → {openTrip.destination} ·{" "}
                {format(new Date(openTrip.departure_at), "EEE d MMM, HH:mm")}
              </p>
              {/* Seat grid: 8 columns, disabled when taken. */}
              <div className="my-4 grid grid-cols-8 gap-2">
                {Array.from({ length: openTrip.total_seats }, (_, i) => i + 1).map((n) => {
                  const isTaken = taken[openTrip.id]?.has(n);
                  const isChosen = chosenSeat === n;
                  return (
                    <button
                      key={n}
                      disabled={isTaken}
                      onClick={() => setChosenSeat(n)}
                      className={`h-9 rounded border text-xs transition ${
                        isTaken
                          ? "cursor-not-allowed border-border bg-muted text-muted-foreground line-through"
                          : isChosen
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  Seat: <strong>{chosenSeat ?? "—"}</strong> · {Number(openTrip.price_sar).toFixed(2)} SAR
                </div>
                <Button onClick={confirmBooking} disabled={!chosenSeat || booking}>
                  {booking ? "Booking…" : "Confirm booking"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
