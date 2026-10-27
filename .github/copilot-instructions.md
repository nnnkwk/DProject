# Workspace instructions

This workspace contains a JavaScript Discord role-request bot using discord.js v14 and MySQL (`mysql2`). Keep bot credentials in `.env` only; never commit secrets. Use parameterized SQL queries, restrict all catalogue and request operations by Discord guild ID, and preserve the role hierarchy and moderator permission checks. SQL schema changes belong in `schema.sql`; update `README.md` when setup or commands change. Use Node.js 20.11+ and ESM imports.
