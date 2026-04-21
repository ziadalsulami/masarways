/**
 * Passenger — list of own bookings with cancel + re-download receipt.
 * Cancelling sets status='cancelled', which immediately frees the seat
 * thanks to our partial unique index on active bookings only.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";
import { downloadReceipt } from "@/lib/pdf";

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

export default function MyBookings() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Booking[]>([]);

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

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <h1 className="mb-6 text-2xl font-semibold">My bookings</h1>

      <div className="grid gap-3">
        {rows.map((b) => (
          <Card key={b.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">
                {b.trips?.origin} → {b.trips?.destination}{" "}
                <span className="ml-2 text-xs text-muted-foreground">{b.reference}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {b.trips?.trains?.code} ·{" "}
                {b.trips && format(new Date(b.trips.departure_at), "EEE d MMM, HH:mm")} · Seat #{b.seat_number}
              </div>
              <div
                className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${
                  b.status === "active"
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {b.status}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => reDownload(b)}>
                Receipt
              </Button>
              {b.status === "active" && (
                <Button variant="destructive" size="sm" onClick={() => cancel(b.id)}>
                  Cancel
                </Button>
              )}
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground">You have no bookings yet.</p>}
      </div>
    </AppShell>
  );
}
