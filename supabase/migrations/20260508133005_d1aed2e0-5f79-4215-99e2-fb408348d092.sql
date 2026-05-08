CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique
ON public.profiles (lower(email));

CREATE OR REPLACE FUNCTION public.ensure_passenger_profile(
  _full_name text,
  _email text,
  _phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _jwt_email text := auth.jwt() ->> 'email';
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to finish creating your account';
  END IF;

  IF length(trim(coalesce(_full_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF coalesce(_email, '') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  IF _jwt_email IS NOT NULL AND lower(trim(_email)) <> lower(trim(_jwt_email)) THEN
    RAISE EXCEPTION 'Profile email must match the signed-in account email';
  END IF;

  IF coalesce(_phone, '') !~ '^\+[0-9]{1,4}[0-9]{8,11}$' THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(email) = lower(trim(_email))
      AND id <> _uid
  ) THEN
    RAISE EXCEPTION 'This email is already used by another account';
  END IF;

  INSERT INTO public.profiles (id, masar_id, full_name, email, phone, national_id)
  VALUES (
    _uid,
    public.next_masar_id('passenger'),
    trim(_full_name),
    lower(trim(_email)),
    _phone,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'passenger')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_passenger_profile(text, text, text) TO authenticated;