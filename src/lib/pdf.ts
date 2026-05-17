/**
 * Generates a printable PDF receipt for a confirmed booking using jsPDF.
 *
 * Kept dependency-free of React so the booking page can call it directly
 * after a successful insert. All values are passed in plain — no DB
 * lookup happens here.
 */
import jsPDF from "jspdf";
import { format } from "date-fns";

export interface ReceiptData {
  reference: string;
  passengerName: string;
  masarId: string;
  trainCode: string;
  trainName: string;
  origin: string;
  destination: string;
  departure: string; // ISO
  arrival: string;   // ISO
  /** All seats included on this receipt (supports multi-ticket bookings). */
  seatNumbers: number[];
  adults: number;
  kids: number;
  /** Per-adult ticket price in SAR. Kids are billed at 50% of this. */
  priceSar: number;
}

export function downloadReceipt(d: ReceiptData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const left = 56;
  let y = 64;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("MASAR", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Train Schedule & Reservation Management", left, y + 16);

  // Receipt title
  y += 56;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Booking Confirmation", left, y);

  // Reference + date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 18;
  doc.text(`Reference: ${d.reference}`, left, y);
  y += 14;
  doc.text(`Issued:    ${format(new Date(), "yyyy-MM-dd HH:mm")}`, left, y);

  // Separator
  y += 14;
  doc.setDrawColor(200);
  doc.line(left, y, 540, y);

  // Field renderer — keeps the layout consistent.
  const row = (label: string, value: string) => {
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.text(label, left, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, left + 140, y);
  };

  row("Passenger:",   d.passengerName);
  row("MASAR ID:",    d.masarId);
  row("Train:",       `${d.trainCode} — ${d.trainName}`);
  row("Route:",       `${d.origin} → ${d.destination}`);
  row("Departure:",   format(new Date(d.departure), "yyyy-MM-dd HH:mm"));
  row("Arrival:",     format(new Date(d.arrival),   "yyyy-MM-dd HH:mm"));
  row("Seat:",        `#${d.seatNumber}`);
  row("Price:",       `${d.priceSar.toFixed(2)} SAR`);

  // Notes
  y += 30;
  doc.setDrawColor(200);
  doc.line(left, y, 540, y);
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.text("Important notes", left, y);
  doc.setFont("helvetica", "normal");
  const notes = [
    "• Please arrive at the station at least 30 minutes before departure.",
    "• A valid government ID matching the booking name is required at boarding.",
    "• This receipt and the seat assignment are non-transferable.",
    "• Cancellations can be made from the My Bookings page before departure.",
  ];
  notes.forEach((n) => {
    y += 14;
    doc.text(n, left, y);
  });

  doc.save(`MASAR-${d.reference}.pdf`);
}

/* -----------------------------------------------------------------------
 * Report PDF — used by the admin Reports page.
 * Renders KPIs, a daily breakdown table, and a top-routes table.
 * --------------------------------------------------------------------- */

export interface ReportData {
  from: string; // yyyy-MM-dd
  to: string;
  summary: { total: number; active: number; cancelled: number; revenue: number };
  daily: { day: string; active: number; cancelled: number; revenue: number }[];
  routes: { route: string; revenue: number }[];
}

export function downloadReport(r: ReportData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const left = 56;
  let y = 64;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("MASAR — Operations Report", left, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 18;
  doc.text(`Period: ${r.from} → ${r.to}`, left, y);
  y += 12;
  doc.text(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`, left, y);

  // Separator
  y += 14;
  doc.setDrawColor(200);
  doc.line(left, y, 540, y);

  // KPI block
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.text("Summary", left, y);
  doc.setFont("helvetica", "normal");
  const kpi = (label: string, value: string) => {
    y += 16;
    doc.text(label, left, y);
    doc.text(value, left + 200, y);
  };
  kpi("Total bookings:",     String(r.summary.total));
  kpi("Active bookings:",    String(r.summary.active));
  kpi("Cancelled bookings:", String(r.summary.cancelled));
  kpi("Revenue (SAR):",      r.summary.revenue.toFixed(2));

  // Daily breakdown table
  y += 30;
  doc.setFont("helvetica", "bold");
  doc.text("Daily breakdown", left, y);
  y += 14;
  doc.setFontSize(9);
  doc.text("Day",        left,        y);
  doc.text("Active",     left + 160,  y);
  doc.text("Cancelled",  left + 230,  y);
  doc.text("Revenue",    left + 320,  y);
  doc.setFont("helvetica", "normal");
  doc.line(left, y + 2, 540, y + 2);

  r.daily.forEach((d) => {
    y += 13;
    if (y > 780) { doc.addPage(); y = 64; }
    doc.text(d.day,                      left,        y);
    doc.text(String(d.active),           left + 160,  y);
    doc.text(String(d.cancelled),        left + 230,  y);
    doc.text(d.revenue.toFixed(2),       left + 320,  y);
  });

  // Top routes
  y += 30;
  if (y > 720) { doc.addPage(); y = 64; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Top routes by revenue", left, y);
  y += 14;
  doc.setFontSize(9);
  doc.text("Route",   left,       y);
  doc.text("Revenue", left + 320, y);
  doc.setFont("helvetica", "normal");
  doc.line(left, y + 2, 540, y + 2);
  r.routes.forEach((rt) => {
    y += 13;
    if (y > 780) { doc.addPage(); y = 64; }
    doc.text(rt.route,                left,        y);
    doc.text(rt.revenue.toFixed(2),   left + 320,  y);
  });

  doc.save(`MASAR-report-${r.from}_${r.to}.pdf`);
}
