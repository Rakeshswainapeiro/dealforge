-- Better Auth tables for a fresh database.
--
-- Better Auth is configured with advanced.database.validateSchema = false, so it
-- does not create its own tables. server/db.js creates the application tables but
-- not these, so a brand-new database (fresh deploy or `docker compose up` with an
-- empty volume) fails to seed tenants/users with "relation auth_org does not
-- exist" until this migration is applied. Existing developer databases already
-- have these from an earlier `better-auth` CLI run, which masked the gap.
--
-- Apply with:
--   psql "$DATABASE_URL" -f server/migrations/0001_better_auth.sql
-- Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role text,
    banned boolean,
    "banReason" text,
    "banExpires" timestamptz,
    CONSTRAINT user_pkey PRIMARY KEY (id),
    CONSTRAINT user_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    scope text,
    password text,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz NOT NULL,
    CONSTRAINT account_pkey PRIMARY KEY (id),
    CONSTRAINT account_userId_fkey FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON account USING btree ("userId");

CREATE TABLE IF NOT EXISTS session (
    id text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    token text NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL,
    "activeOrganizationId" text,
    "impersonatedBy" text,
    CONSTRAINT session_pkey PRIMARY KEY (id),
    CONSTRAINT session_token_key UNIQUE (token),
    CONSTRAINT session_userId_fkey FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON session USING btree ("userId");

CREATE TABLE IF NOT EXISTS verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT verification_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification USING btree (identifier);

CREATE TABLE IF NOT EXISTS auth_org (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamptz NOT NULL,
    metadata text,
    CONSTRAINT auth_org_pkey PRIMARY KEY (id),
    CONSTRAINT auth_org_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS auth_member (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    role text NOT NULL,
    "createdAt" timestamptz NOT NULL,
    CONSTRAINT auth_member_pkey PRIMARY KEY (id),
    CONSTRAINT auth_member_organizationId_fkey FOREIGN KEY ("organizationId") REFERENCES auth_org(id) ON DELETE CASCADE,
    CONSTRAINT auth_member_userId_fkey FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "auth_member_organizationId_idx" ON auth_member USING btree ("organizationId");
CREATE INDEX IF NOT EXISTS "auth_member_userId_idx" ON auth_member USING btree ("userId");

CREATE TABLE IF NOT EXISTS auth_invitation (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    email text NOT NULL,
    role text,
    status text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" text NOT NULL,
    CONSTRAINT auth_invitation_pkey PRIMARY KEY (id),
    CONSTRAINT auth_invitation_inviterId_fkey FOREIGN KEY ("inviterId") REFERENCES "user"(id) ON DELETE CASCADE,
    CONSTRAINT auth_invitation_organizationId_fkey FOREIGN KEY ("organizationId") REFERENCES auth_org(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_invitation_email_idx ON auth_invitation USING btree (email);
CREATE INDEX IF NOT EXISTS "auth_invitation_organizationId_idx" ON auth_invitation USING btree ("organizationId");
