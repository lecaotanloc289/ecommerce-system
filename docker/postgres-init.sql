-- Bootstrap script run once on Postgres first start.
-- Creates the Prisma shadow database and enables required extensions on both DBs.

CREATE DATABASE ecommerce_shadow;

\connect ecommerce
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\connect ecommerce_shadow
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
