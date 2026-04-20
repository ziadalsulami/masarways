/**
 * Shared admin navigation. Imported by every admin page so the top bar
 * shows the same set of links everywhere.
 */
export const ADMIN_NAV = [
  { to: "/admin",            label: "Dashboard" },
  { to: "/admin/trips",      label: "Trips" },
  { to: "/admin/trains",     label: "Trains" },
  { to: "/admin/passengers", label: "Passengers" },
  { to: "/admin/bookings",   label: "Bookings" },
  { to: "/admin/reports",    label: "Reports" },
  { to: "/account",          label: "My account" },
];
