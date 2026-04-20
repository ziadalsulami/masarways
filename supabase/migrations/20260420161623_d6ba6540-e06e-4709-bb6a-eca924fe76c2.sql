
-- =========================================================
-- MASAR — Train Schedule & Reservation Management System
-- Initial schema
-- =========================================================

-- Roles enum (admin / passenger)
CREATE TYPE public.app_role AS ENUM ('admin', 'passenger');

-- Trip status enum
CREATE TYPE public.trip_status AS ENUM ('scheduled', 'departed', 'arrived', 'cancelled');

-- Booking status enum
CREATE TYPE public.booking_status AS ENUM ('active', 'cancelled');

-- ---------------------------------------------------------
-- profiles: one row per registered user (admin OR passenger)
-- masar_id is the human-readable ID: A#### for admins, P#### for passengers
-- ---------------------------------------------------------
CREATE TABLE public.profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  masar_id     text UNIQUE NOT NULL,
  full_name    text NOT NULL,
  email        text NOT NULL,
  phone        text NOT NULL,
  national_id  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- user_roles: roles MUST live in a separate table (security best practice)
-- ---------------------------------------------------------
CREATE TABLE public.user_roles (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role     public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Security-definer helper to check a user's role without recursive RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- ---------------------------------------------------------
-- trains: master list of train units
-- ---------------------------------------------------------
CREATE TABLE public.trains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,        -- e.g. SAR-101
  name        text NOT NULL,               -- e.g. Haramain Express
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- trips: a scheduled run of a train between two cities
-- ---------------------------------------------------------
CREATE TABLE public.trips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id      uuid NOT NULL REFERENCES public.trains(id) ON DELETE RESTRICT,
  origin        text NOT NULL,
  destination   text NOT NULL,
  departure_at  timestamptz NOT NULL,
  arrival_at    timestamptz NOT NULL,
  total_seats   int  NOT NULL CHECK (total_seats > 0),
  price_sar     numeric(10,2) NOT NULL CHECK (price_sar >= 0),
  status        public.trip_status NOT NULL DEFAULT 'scheduled',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (arrival_at > departure_at),
  CHECK (origin <> destination)
);
CREATE INDEX idx_trips_departure ON public.trips(departure_at);

-- ---------------------------------------------------------
-- bookings: a passenger reserves one seat on one trip
-- Constraints guarantee:
--   * a seat number cannot be double-booked on the same trip
--   * a passenger cannot have two ACTIVE bookings on the same trip
-- ---------------------------------------------------------
CREATE TABLE public.bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text UNIQUE NOT NULL,                   -- e.g. MSR-AB12CD
  trip_id       uuid NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  passenger_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seat_number   int  NOT NULL CHECK (seat_number > 0),
  status        public.booking_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Only ACTIVE bookings count toward uniqueness (cancelled seats can be re-booked)
CREATE UNIQUE INDEX uniq_active_seat_per_trip
  ON public.bookings(trip_id, seat_number) WHERE status = 'active';
CREATE UNIQUE INDEX uniq_active_booking_per_passenger_trip
  ON public.bookings(passenger_id, trip_id) WHERE status = 'active';

-- =========================================================
-- Triggers / helper functions
-- =========================================================

-- Generic updated_at-style timestamp keeper (kept generic for future use)
CREATE OR REPLACE FUNCTION public.touch_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.created_at = COALESCE(NEW.created_at, now()); RETURN NEW; END;
$$;

-- Generates the next MASAR ID (A0001 or P0001) for a given role
CREATE OR REPLACE FUNCTION public.next_masar_id(_role public.app_role)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  n int;
BEGIN
  prefix := CASE WHEN _role = 'admin' THEN 'A' ELSE 'P' END;
  -- count existing profiles whose masar_id starts with the prefix
  SELECT COUNT(*) + 1 INTO n FROM public.profiles WHERE masar_id LIKE prefix || '%';
  RETURN prefix || lpad(n::text, 4, '0');
END;
$$;

-- On new auth user: read metadata (full_name, phone, national_id, role)
-- and create a matching profile + role row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.app_role;
  _masar text;
BEGIN
  -- Default role is passenger; admins are seeded directly
  _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'passenger');
  _masar := public.next_masar_id(_role);

  INSERT INTO public.profiles (id, masar_id, full_name, email, phone, national_id)
  VALUES (
    NEW.id,
    _masar,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unnamed'),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.raw_user_meta_data->>'national_id'
  );

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- Row Level Security
-- =========================================================
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trains      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings    ENABLE ROW LEVEL SECURITY;

-- profiles: a user sees their own profile; admins see all
CREATE POLICY "profiles_self_select"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_self_update"   ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin_all"     ON public.profiles FOR ALL    TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- user_roles: a user sees their own roles; admins manage all
CREATE POLICY "roles_self_select"  ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_all"    ON public.user_roles FOR ALL    TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- trains: any signed-in user may read; only admins may write
CREATE POLICY "trains_read_all"   ON public.trains FOR SELECT TO authenticated USING (true);
CREATE POLICY "trains_admin_all"  ON public.trains FOR ALL    TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- trips: any signed-in user may read; only admins may write
CREATE POLICY "trips_read_all"    ON public.trips FOR SELECT TO authenticated USING (true);
CREATE POLICY "trips_admin_all"   ON public.trips FOR ALL    TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- bookings: passenger sees own; admin sees all
CREATE POLICY "bookings_self_select" ON public.bookings FOR SELECT TO authenticated USING (passenger_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "bookings_self_insert" ON public.bookings FOR INSERT TO authenticated WITH CHECK (passenger_id = auth.uid());
CREATE POLICY "bookings_self_update" ON public.bookings FOR UPDATE TO authenticated USING (passenger_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "bookings_admin_all"   ON public.bookings FOR ALL    TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- Seed reference data: trains
-- =========================================================
INSERT INTO public.trains (code, name) VALUES
  ('SAR-101', 'Haramain Express'),
  ('SAR-202', 'North Line Rapid'),
  ('SAR-303', 'East Coast Connector'),
  ('SAR-404', 'Riyadh Metro Link');

-- Seed trips (all departures in the future)
INSERT INTO public.trips (train_id, origin, destination, departure_at, arrival_at, total_seats, price_sar)
SELECT id, 'Riyadh',  'Jeddah',     now() + interval '2 day'  + interval '8 hour',  now() + interval '2 day'  + interval '12 hour', 60, 250.00 FROM public.trains WHERE code='SAR-101' UNION ALL
SELECT id, 'Jeddah',  'Madinah',    now() + interval '3 day'  + interval '10 hour', now() + interval '3 day'  + interval '12 hour', 60, 180.00 FROM public.trains WHERE code='SAR-101' UNION ALL
SELECT id, 'Riyadh',  'Dammam',     now() + interval '4 day'  + interval '7 hour',  now() + interval '4 day'  + interval '11 hour', 50, 220.00 FROM public.trains WHERE code='SAR-202' UNION ALL
SELECT id, 'Dammam',  'Al-Ahsa',    now() + interval '5 day'  + interval '14 hour', now() + interval '5 day'  + interval '16 hour', 50, 120.00 FROM public.trains WHERE code='SAR-303' UNION ALL
SELECT id, 'Madinah', 'Makkah',     now() + interval '6 day'  + interval '9 hour',  now() + interval '6 day'  + interval '11 hour', 60, 200.00 FROM public.trains WHERE code='SAR-101' UNION ALL
SELECT id, 'Riyadh',  'Buraidah',   now() + interval '7 day'  + interval '6 hour',  now() + interval '7 day'  + interval '9 hour',  40, 150.00 FROM public.trains WHERE code='SAR-404';

-- =========================================================
-- Seed demo auth users (admin & passenger) with password "1234"
-- We insert directly into auth.users so the trigger creates profiles.
-- crypt() with bf hashes the password the way Supabase Auth expects.
-- =========================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(), 'authenticated', 'authenticated',
    'admin@masar.local', crypt('1234', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"System Administrator","phone":"+966500000001","role":"admin"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(), 'authenticated', 'authenticated',
    'passenger@masar.local', crypt('1234', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ahmed Al-Saud","phone":"+966500000002","national_id":"1010101010","role":"passenger"}'::jsonb,
    now(), now(), '', '', '', ''
  );
