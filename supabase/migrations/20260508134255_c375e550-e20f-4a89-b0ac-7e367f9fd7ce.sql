
-- 1) Reset demo passwords
UPDATE auth.users
   SET encrypted_password = crypt('1234', gen_salt('bf')),
       updated_at = now()
 WHERE email IN ('admin@masar.local','passenger@masar.local');

-- 2) Reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('daily','weekly','monthly','custom')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  total_bookings int NOT NULL DEFAULT 0,
  active_bookings int NOT NULL DEFAULT 0,
  cancelled_bookings int NOT NULL DEFAULT 0,
  revenue_sar numeric NOT NULL DEFAULT 0,
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reports_admin_all ON public.reports;
CREATE POLICY reports_admin_all ON public.reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3) Loosen phone regex
CREATE OR REPLACE FUNCTION public.ensure_passenger_profile(_full_name text, _email text, _phone text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _jwt_email text := auth.jwt() ->> 'email';
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'You must be signed in to finish creating your account'; END IF;
  IF length(trim(coalesce(_full_name, ''))) < 2 THEN RAISE EXCEPTION 'Full name is required'; END IF;
  IF coalesce(_email, '') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN RAISE EXCEPTION 'Invalid email address'; END IF;
  IF _jwt_email IS NOT NULL AND lower(trim(_email)) <> lower(trim(_jwt_email)) THEN RAISE EXCEPTION 'Profile email must match the signed-in account email'; END IF;
  IF coalesce(_phone, '') !~ '^\+[0-9]{9,15}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = lower(trim(_email)) AND id <> _uid) THEN
    RAISE EXCEPTION 'This email is already used by another account';
  END IF;
  INSERT INTO public.profiles (id, masar_id, full_name, email, phone, national_id)
  VALUES (_uid, public.next_masar_id('passenger'), trim(_full_name), lower(trim(_email)), _phone, NULL)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'passenger')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$function$;

-- 4) Seed 30 Arabic-named passenger accounts (handle_new_user trigger fills profiles+roles)
DO $seed$
DECLARE
  arabic_names text[] := ARRAY[
    'محمد العتيبي','أحمد القحطاني','عبدالله الشمري','فهد المطيري','خالد الدوسري',
    'سلطان الغامدي','ناصر الزهراني','سعد الحربي','تركي السبيعي','بندر الرشيدي',
    'يوسف العنزي','عمر البقمي','راشد الأحمدي','مازن الجهني','طلال الصاعدي',
    'نواف الفايز','زياد الخالدي','ماجد العمري','فيصل العبدلي','وليد الثقفي',
    'نورة السديري','هند البليهي','ريم الفهد','لمى المهنا','عبير القرني',
    'دانة الحارثي','شهد الرويلي','جواهر الحازمي','سارة الحمد','منى العصيمي'
  ];
  uid uuid; nm text; em text; ph text; n int := 0;
BEGIN
  FOREACH nm IN ARRAY arabic_names LOOP
    n := n + 1;
    uid := gen_random_uuid();
    em := 'mock' || extract(epoch from now())::bigint || n || '@masar.demo';
    ph := '+9665' || lpad((10000000 + n)::text, 8, '0');

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated',
      em, crypt('1234', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', nm, 'phone', ph, 'role','passenger'),
      false
    );
  END LOOP;
END $seed$;

-- 5) Seed 10 May/June 2026 trips with bookings
DO $seedtrips$
DECLARE
  train_ids uuid[];
  pax_ids uuid[];
  routes text[][] := ARRAY[
    ARRAY['Riyadh','Jeddah'], ARRAY['Makkah','Madinah'], ARRAY['Dammam','Riyadh'],
    ARRAY['Jeddah','Makkah'], ARRAY['Madinah','Jeddah'], ARRAY['Riyadh','Dammam'],
    ARRAY['Tabuk','Madinah'], ARRAY['Abha','Jeddah'],   ARRAY['Hail','Riyadh'],
    ARRAY['Buraidah','Makkah']
  ];
  i int; j int; trip_id uuid; departure timestamptz;
  taken int; total int := 40;
BEGIN
  SELECT array_agg(id) INTO train_ids FROM public.trains;
  SELECT array_agg(id) INTO pax_ids FROM public.profiles WHERE masar_id LIKE 'P%';
  FOR i IN 1..10 LOOP
    departure := (TIMESTAMPTZ '2026-05-12 08:00:00+03') + ((i-1) * interval '4 days') + ((i % 6) * interval '1 hour');
    INSERT INTO public.trips(origin, destination, departure_at, arrival_at, total_seats, price_sar, train_id, status)
    VALUES (
      routes[i][1], routes[i][2], departure, departure + interval '4 hours',
      total, 120 + i * 25,
      train_ids[1 + ((i-1) % array_length(train_ids,1))], 'scheduled'
    ) RETURNING id INTO trip_id;
    taken := 6 + (i % 12);
    FOR j IN 1..taken LOOP
      INSERT INTO public.bookings(passenger_id, trip_id, reference, seat_number, status)
      VALUES (
        pax_ids[1 + ((i*7 + j) % array_length(pax_ids,1))],
        trip_id,
        'MK' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
        j, 'active'
      );
    END LOOP;
  END LOOP;
END $seedtrips$;
