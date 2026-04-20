import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import AdminDashboard from "./pages/admin/AdminDashboard.tsx";
import AdminTrips from "./pages/admin/AdminTrips.tsx";
import AdminTrains from "./pages/admin/AdminTrains.tsx";
import AdminPassengers from "./pages/admin/AdminPassengers.tsx";
import AdminBookings from "./pages/admin/AdminBookings.tsx";
import AdminReports from "./pages/admin/AdminReports.tsx";
import PassengerTrips from "./pages/passenger/Trips.tsx";
import MyBookings from "./pages/passenger/MyBookings.tsx";
import Confirmation from "./pages/passenger/Confirmation.tsx";
import NotFound from "./pages/NotFound.tsx";
import MyAccount from "./pages/MyAccount.tsx";
import ProtectedRoute2 from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

/** Helper to wrap each admin page with the role guard. */
const adminRoute = (el: JSX.Element) => (
  <ProtectedRoute requireRole="admin">{el}</ProtectedRoute>
);
/** Helper to wrap each passenger page with the role guard. */
const paxRoute = (el: JSX.Element) => (
  <ProtectedRoute requireRole="passenger">{el}</ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />

            {/* Administrator module */}
            <Route path="/admin"            element={adminRoute(<AdminDashboard />)} />
            <Route path="/admin/trips"      element={adminRoute(<AdminTrips />)} />
            <Route path="/admin/trains"     element={adminRoute(<AdminTrains />)} />
            <Route path="/admin/passengers" element={adminRoute(<AdminPassengers />)} />
            <Route path="/admin/bookings"   element={adminRoute(<AdminBookings />)} />
            <Route path="/admin/reports"    element={adminRoute(<AdminReports />)} />

            {/* Passenger module */}
            <Route path="/app"                            element={paxRoute(<PassengerTrips />)} />
            <Route path="/app/bookings"                   element={paxRoute(<MyBookings />)} />
            <Route path="/app/confirmation/:reference"    element={paxRoute(<Confirmation />)} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
