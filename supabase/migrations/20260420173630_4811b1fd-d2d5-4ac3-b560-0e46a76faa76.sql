create policy "bookings_active_read_all"
on public.bookings
for select
to authenticated
using (status = 'active'::public.booking_status);