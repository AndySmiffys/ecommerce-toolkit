#!/bin/sh
# Starts the app in a container. The database login arrives as separate settings (so the password can be kept in a
# secret store); this joins them into the one connection string Prisma needs, then applies any new migrations.
set -e

if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  # The password is letters and numbers only, so it needs no escaping in the address.
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-promotion}?sslmode=require&connection_limit=10"
fi

npx prisma migrate deploy
exec npx react-router-serve ./build/server/index.js
