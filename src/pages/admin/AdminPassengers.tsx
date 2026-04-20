/**
 * Admin — Passenger directory.
 * Lists every registered passenger (MASAR ID starting with "P") plus
 * a count of their active and total bookings. Clicking a row expands
 * to show the booking history.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ADMIN_NAV } from "./nav";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

interface Passenger {
  id: string;
  masar_id: string;
  full_name: string;
  email: string;
  phone: string;
  created_at: string;
}

interface BookingRow {
  id: string;
  reference: string;
  seat_number: number;
  status: "active" | "cancelled";
  passenger_id: string;
  trips: { origin: string; destination: string; departure_at: string } | null;
}

export default function AdminPassengers() {
  const [pax, setPax] = useState<Passenger[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const [pRes, bRes] = await Promise.all([
      supabase.from("profiles").select("id, masar_id, full_name, email, phone, created_at")
        .like("masar_id", "P%").order("masar_id"),
      supabase.from("bookings").select("id, reference, seat_number, status, passenger_id, trips(origin,destination,departure_at)"),
    ]);
    setPax((pRes.data ?? []) as Passenger[]);
    setBookings((bRes.data ?? []) as unknown as BookingRow[]);
  };
  useEffect(() => { load(); }, []);

  // Pre-bucket bookings per passenger for fast expansion + counts.
  const byPassenger = useMemo(() => {
    const m: Record<string, BookingRow[]> = {};
    bookings.forEach((b) => { (m[b.passenger_id] ||= []).push(b); });
    return m;
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pax;
    return pax.filter((p) =>
      [p.full_name, p.email, p.phone, p.masar_id].some((v) => v.toLowerCase().includes(q)),
    );
  }, [pax, query]);

  return (
    <AppShell nav={ADMIN_NAV}>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Passengers</h1>
          <p className="text-sm text-muted-foreground">{pax.length} registered passengers.</p>
        </div>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by name, email, ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2"></th>
              <th className="px-4 py-2">MASAR ID</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Joined</th>
              <th className="px-4 py-2">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {filtered.flatMap((p) => {
              const list = byPassenger[p.id] ?? [];
              const active = list.filter((b) => b.status === "active").length;
              const expanded = openId === p.id;
              const out: JSX.Element[] = [
                <tr
                  key={p.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                  onClick={() => setOpenId(expanded ? null : p.id)}
                >
                  <td className="px-2 py-2 text-muted-foreground">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </td>
                  <td className="px-4 py-2 font-mono">{p.masar_id}</td>
                  <td className="px-4 py-2">{p.full_name}</td>
                  <td className="px-4 py-2">{p.email}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.phone}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{format(new Date(p.created_at), "yyyy-MM-dd")}</td>
                  <td className="px-4 py-2">{active} active · {list.length} total</td>
                </tr>,
              ];
              if (expanded) {
                out.push(
                  <tr key={`${p.id}-detail`} className="border-t border-border bg-muted/10">
                    <td></td>
                    <td colSpan={6} className="px-4 py-3">
                      {list.length === 0 ? (
                        <span className="text-muted-foreground">No bookings.</span>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {list.map((b) => (
                            <li key={b.id} className="flex items-center justify-between">
                              <span>
                                <span className="font-mono">{b.reference}</span> ·{" "}
                                {b.trips?.origin} → {b.trips?.destination} ·{" "}
                                {b.trips && format(new Date(b.trips.departure_at), "yyyy-MM-dd HH:mm")} ·{" "}
                                Seat #{b.seat_number}
                              </span>
                              <span className={`rounded px-1.5 py-0.5 ${b.status === "active" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                                {b.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>,
                );
              }
              return out;
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No passengers match.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
