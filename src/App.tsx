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
import PassengerTrips from "./pages/passenger/Trips.tsx";
import MyBookings from "./pages/passenger/MyBookings.tsx";
import Confirmation from "./pages/passenger/Confirmation.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

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
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireRole="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* Passenger module */}
            <Route
              path="/app"
              element={
                <ProtectedRoute requireRole="passenger">
                  <PassengerTrips />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/bookings"
              element={
                <ProtectedRoute requireRole="passenger">
                  <MyBookings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/confirmation/:reference"
              element={
                <ProtectedRoute requireRole="passenger">
                  <Confirmation />
                </ProtectedRoute>
              }
            />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
