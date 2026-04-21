-- Create an admin-only view exposing the hashed passwords stored by Supabase Auth.
-- This makes it visible in the database that passwords are stored only as bcrypt hashes
-- (never as plain text). Only admins can read it.

CREATE OR REPLACE VIEW public.user_credentials AS
SELECT
  u.id              AS user_id,
  u.email,
  u.encrypted_password AS hashed_password,
  u.created_at,
  u.last_sign_in_at
FROM auth.users u;

-- Lock down: only admins may read this view. Revoke from anon/authenticated, regrant via SECURITY DEFINER function.
REVOKE ALL ON public.user_credentials FROM PUBLIC, anon, authenticated;

-- Provide a SECURITY DEFINER function admins can call to fetch the rows safely.
CREATE OR REPLACE FUNCTION public.admin_list_credentials()
RETURNS TABLE (user_id uuid, email text, hashed_password text, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admins only';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, u.encrypted_password::text, u.created_at, u.last_sign_in_at
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_credentials() TO authenticated;