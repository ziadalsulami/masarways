/**
 * Confirmation page shown right after a successful booking. Looks up
 * the booking by its reference (passed in the URL), shows the receipt
 * details and lets the user re-download the PDF if needed.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { downloadReceipt } from "@/lib/pdf";

export default function Confirmation() {
  const { reference } = useParams<{ reference: string }>();
  const { profile } = useAuth();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!reference) return;
    (async () => {
      const { data } = await supabase
        .from("bookings")
        .select(
          "reference, seat_number, trip_id, trips(origin,destination,departure_at,arrival_at,price_sar, trains(code,name))",
        )
        .eq("reference", reference)
        .maybeSingle();
      setData(data);
    })();
  }, [reference]);

  if (!data || !profile) return <AppShell>Loading…</AppShell>;

  const trip = data.trips;

  const handleDownload = () =>
    downloadReceipt({
      reference: data.reference,
      passengerName: profile.full_name,
      masarId: profile.masar_id,
      trainCode: trip.trains?.code ?? "",
      trainName: trip.trains?.name ?? "",
      origin: trip.origin,
      destination: trip.destination,
      departure: trip.departure_at,
      arrival: trip.arrival_at,
      seatNumbers: [data.seat_number],
      adults: 1,
      kids: 0,
      priceSar: Number(trip.price_sar),
    });

  return (
    <AppShell
      nav={[
        { to: "/app", label: "Trips" },
        { to: "/app/bookings", label: "My bookings" },
      ]}
    >
      <Card className="mx-auto max-w-xl p-8">
        <div className="mb-4 flex items-center gap-2 text-primary">
          <CheckCircle2 className="h-6 w-6" />
          <h1 className="text-xl font-semibold">Booking confirmed</h1>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Your seat is reserved. The PDF receipt has been downloaded — keep it for boarding.
        </p>

        <dl className="grid grid-cols-3 gap-y-3 text-sm">
          <Field label="Reference" value={data.reference} />
          <Field label="Trip ID" value={data.trip_id} mono />
          <Field label="Passenger" value={`${profile.full_name} (${profile.masar_id})`} />
          <Field label="Train" value={`${trip.trains?.code} — ${trip.trains?.name}`} />
          <Field label="Route" value={`${trip.origin} → ${trip.destination}`} />
          <Field label="Departure" value={format(new Date(trip.departure_at), "yyyy-MM-dd HH:mm")} />
          <Field label="Arrival" value={format(new Date(trip.arrival_at), "yyyy-MM-dd HH:mm")} />
          <Field label="Seat" value={`#${data.seat_number}`} />
          <Field label="Price" value={`${Number(trip.price_sar).toFixed(2)} SAR`} />
        </dl>

        <div className="mt-6 rounded border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <strong className="block text-foreground">Important notes</strong>
          Please arrive 30 minutes before departure with a valid ID matching the booking name.
          Seat assignment is non-transferable. Cancellations can be made from My Bookings.
        </div>

        <div className="mt-6 flex gap-2">
          <Button onClick={handleDownload}>Download receipt (PDF)</Button>
          <Button variant="outline" asChild>
            <Link to="/app/bookings">My bookings</Link>
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="col-span-1 text-muted-foreground">{label}</dt>
      <dd className={`col-span-2 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </>
  );
}
