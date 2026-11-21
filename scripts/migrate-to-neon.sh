#!/bin/sh
set -eu
set +x

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL in the migration job environment}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL in the migration job environment}"

echo "Starting PostgreSQL migration from Render to Neon."
echo "Source and destination credentials are not printed."

# Create a complete custom-format dump, including schema, data, indexes,
# constraints, sequences, functions, triggers, and extension declarations.
pg_dump --format=custom --no-owner --no-acl --verbose \
  --file=/tmp/maleficentchat.dump "$SOURCE_DATABASE_URL"

echo "Dump created. Restoring into the new Neon database."
# Destination must be the newly created, empty Maleficent Chat Neon database.
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --verbose \
  --dbname="$TARGET_DATABASE_URL" /tmp/maleficentchat.dump

echo "Restore completed. Checking table counts on source and destination."
SOURCE_TABLES="$(psql "$SOURCE_DATABASE_URL" -X -A -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE';" | tr -d '[:space:]')"
TARGET_TABLES="$(psql "$TARGET_DATABASE_URL" -X -A -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE';" | tr -d '[:space:]')"

echo "Source tables: $SOURCE_TABLES"
echo "Destination tables: $TARGET_TABLES"
if [ "$SOURCE_TABLES" != "$TARGET_TABLES" ]; then
  echo "ERROR: table-count verification failed."
  exit 1
fi

echo "SUCCESS: PostgreSQL restore finished and base-table counts match."
