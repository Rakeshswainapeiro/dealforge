-- DealForge database roles (NFR-02 least privilege). Run once as a superuser.
-- The owner role holds the schema and runs migrations; the application role
-- reads and writes rows only, cannot change the schema and cannot rewrite the
-- audit trail. Replace the passwords before running.

CREATE ROLE dealforge_owner LOGIN PASSWORD 'change-me-owner';
CREATE ROLE dealforge_app   LOGIN PASSWORD 'change-me-app';

CREATE DATABASE dealforge OWNER dealforge_owner;
\connect dealforge

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO dealforge_owner;
GRANT USAGE ON SCHEMA public TO dealforge_app;

-- Tables created later by migrations are readable/writable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE dealforge_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dealforge_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dealforge_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dealforge_app;

-- Then, as dealforge_owner:
--   DATABASE_URL=postgres://dealforge_owner:...@host/dealforge APP_DB_ROLE=dealforge_app npm run migrate
-- and run the application with:
--   DATABASE_URL=postgres://dealforge_app:...@host/dealforge DB_MIGRATE_ON_BOOT=0
