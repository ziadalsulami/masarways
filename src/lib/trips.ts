import { useEffect, useState } from "react";

export type RawTripStatus = "scheduled" | "departed" | "arrived" | "cancelled";
export type TripDisplayStatus = "active" | "departed" | "cancelled";
export type BookingDisplayStatus = "active" | "departed" | "cancelled";

interface TripLike {
  departure_at?: string | null;
  status?: RawTripStatus | null;
}

interface BookingLike {
  status: "active" | "cancelled";
  trips?: TripLike | null;
}

export const TRIP_STATUS_STYLE: Record<TripDisplayStatus, string> = {
  active: "bg-accent text-accent-foreground",
  departed: "bg-primary/15 text-primary",
  cancelled: "bg-destructive/15 text-destructive",
};

export const BOOKING_STATUS_STYLE: Record<BookingDisplayStatus, string> = {
  active: "bg-accent text-accent-foreground",
  departed: "bg-primary/15 text-primary",
  cancelled: "bg-muted text-muted-foreground",
};

export const hasDeparted = (departureAt?: string | null, now = Date.now()) => {
  if (!departureAt) return false;
  return new Date(departureAt).getTime() <= now;
};

export const isActiveTrip = (trip?: TripLike | null, now = Date.now()) => {
  if (!trip || trip.status === "cancelled") return false;
  if (trip.status === "departed" || trip.status === "arrived") return false;
  return !hasDeparted(trip.departure_at, now);
};

export const getTripDisplayStatus = (trip: TripLike, now = Date.now()): TripDisplayStatus => {
  if (trip.status === "cancelled") return "cancelled";
  return isActiveTrip(trip, now) ? "active" : "departed";
};

export const getBookingDisplayStatus = (booking: BookingLike, now = Date.now()): BookingDisplayStatus => {
  if (booking.status === "cancelled" || booking.trips?.status === "cancelled") return "cancelled";
  return isActiveTrip(booking.trips, now) ? "active" : "departed";
};

export function useMinuteNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}