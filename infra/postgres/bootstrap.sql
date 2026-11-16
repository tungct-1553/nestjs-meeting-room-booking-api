-- Run as the database administrator. No DROP statements or data rewrites.
BEGIN;
SELECT set_config('booking.bootstrap_adopt', :'adopt', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
    WHERE d.datname=current_database() AND r.rolname IN ('booking_user','keycloak_user')
  ) THEN
    RAISE EXCEPTION 'Service roles must not own the database; assign database ownership to an administrator explicitly before bootstrap.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
    WHERE n.nspname='public' AND r.rolname='keycloak_user'
  ) THEN
    RAISE EXCEPTION 'The public application schema must not be owned by keycloak_user; resolve ownership explicitly before bootstrap.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')
      AND (c.relname IN ('users', 'rooms', 'bookings', 'migrations') OR
        (c.relkind = 'S' AND EXISTS (
          SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
          JOIN pg_namespace tn ON tn.oid = t.relnamespace
          WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')
            AND tn.nspname = 'public' AND t.relname IN ('users','rooms','bookings','migrations')
        )))
      AND pg_get_userbyid(c.relowner) <> 'booking_user'
  ) AND current_setting('booking.bootstrap_adopt') <> 'true' THEN
    RAISE EXCEPTION 'Application objects have another owner. Review ownership, then rerun with --adopt-app-objects.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='keycloak' AND pg_get_userbyid(nspowner) <> 'keycloak_user') THEN
    RAISE EXCEPTION 'Existing keycloak schema has another owner; resolve explicitly before bootstrap.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname IN ('booking_user','keycloak_user')
  ) THEN
    RAISE EXCEPTION 'Application database roles must not have memberships in other roles.';
  END IF;
END $$;
SELECT format('CREATE ROLE %I LOGIN', role_name)
FROM (VALUES ('booking_user'), ('keycloak_user')) AS roles(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) \gexec
SELECT format('ALTER ROLE booking_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'booking_password') \gexec
SELECT format('ALTER ROLE keycloak_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'keycloak_password') \gexec
CREATE SCHEMA IF NOT EXISTS keycloak AUTHORIZATION keycloak_user;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM keycloak_user;
GRANT USAGE, CREATE ON SCHEMA public TO booking_user;
REVOKE ALL ON SCHEMA keycloak FROM PUBLIC, booking_user;
GRANT USAGE, CREATE ON SCHEMA keycloak TO keycloak_user;
SELECT format('GRANT CONNECT ON DATABASE %I TO booking_user, keycloak_user', current_database()) \gexec
SELECT format('ALTER ROLE booking_user IN DATABASE %I SET search_path = public', current_database()) \gexec
SELECT format('ALTER ROLE keycloak_user IN DATABASE %I SET search_path = keycloak', current_database()) \gexec
-- Change only the allowlisted application tables and their owned sequences.
SELECT format('ALTER TABLE public.%I OWNER TO booking_user', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('users','rooms','bookings','migrations')
  AND pg_get_userbyid(c.relowner) <> 'booking_user' \gexec
SELECT format('ALTER SEQUENCE public.%I OWNER TO booking_user', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='S' AND EXISTS (
  SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid=d.refobjid
  JOIN pg_namespace tn ON tn.oid=t.relnamespace
  WHERE d.objid=c.oid AND d.deptype IN ('a','i') AND tn.nspname='public'
    AND t.relname IN ('users','rooms','bookings','migrations')
) AND pg_get_userbyid(c.relowner) <> 'booking_user' \gexec
-- Remove any old explicit grants to the opposite service or PUBLIC.
SELECT format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, keycloak_user', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('users','rooms','bookings','migrations') \gexec
-- Sequence operations can use regclass/OID without schema lookup privileges.
SELECT format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, keycloak_user', c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='S' AND EXISTS (
  SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid=d.refobjid
  JOIN pg_namespace tn ON tn.oid=t.relnamespace
  WHERE d.objid=c.oid AND d.deptype IN ('a','i') AND tn.nspname='public'
    AND t.relname IN ('users','rooms','bookings','migrations')
) \gexec
REVOKE ALL ON ALL TABLES IN SCHEMA keycloak FROM PUBLIC, booking_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA keycloak FROM PUBLIC, booking_user;
COMMIT;
