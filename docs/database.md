# Database

The app stores three things in a PostgreSQL database (`prisma/schema.prisma`):

- **`Session`**: Shopify's login tokens for each store. Losing these stops the app publishing to the storefront until each store signs in again.
- **`PromotionSettings`**: the website design, blocks and priority of each promotion.
- **`PromotionCodeBatch`**: progress of bulk code generation, so it can resume.

The app uses any PostgreSQL server through one environment variable, `DATABASE_URL`. SQLite was used earlier. It keeps data in a file inside the app's folder, which most hosts wipe on every restart or deploy and give each instance its own copy of, so it is not used any more.

## Setting it up

1. Create a PostgreSQL database. For development a free hosted one is enough (for example [Neon](https://neon.tech)); for production use the managed PostgreSQL of your host.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the connection string, for example `postgresql://user:password@host:5432/database?sslmode=require`. `.env` is not committed.
3. Run `npm run setup`. It generates the Prisma client and applies the migrations (`prisma migrate deploy`), creating the tables. `npm run dev` does the same on start.

Notes for production:

- **Run migrations with a direct connection.** If you use a pooler (PgBouncer, Neon's pooled address), point the app at the pooled address and run `npx prisma migrate deploy` with the direct address (set `DATABASE_URL` to it for that command).
- **Several instances are fine.** Prisma takes a database lock while migrating, so instances starting together are safe. The app keeps no state in its own memory that matters across instances (the short-lived list of products in a collection is rebuilt on each instance).
- **Backups.** The sessions can be recreated by opening the app, but the promotion designs cannot. Use your host's automatic backups.

## Moving data from the old SQLite file

If you have promotions saved in `prisma/dev.sqlite`, copy them once after `npm run setup`:

```
npm run db:copy-sqlite
```

It copies sessions, promotion settings and code batches, keeps the order of promotions, leaves rows that already exist alone (so it can be run again), and never changes the SQLite file. Use `npm run db:copy-sqlite -- path/to/other.db` for another file. It needs Node 22.13 or later.

## Tests

`npm test` starts a temporary PostgreSQL by itself (the `embedded-postgres` development dependency, no Docker needed), gives each database test a schema of its own built from the migrations, and removes it afterwards. To use another server, set `TEST_DATABASE_URL` to a PostgreSQL URL the tests may create schemas in.

## Changing the schema

Edit `prisma/schema.prisma`, then run `npx prisma migrate dev --name what_changed` against your development database. Commit the new folder under `prisma/migrations`.
