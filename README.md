# Workshop Ledger

A responsive workshop ledger for sales, inventory, budgets and profit & loss. Data is stored in Supabase Postgres and accessed only after signing in. Database row-level security restricts every ledger row and setting to its owner account; the browser stores no ledger data locally.

## Local setup

1. Create a Supabase project and copy its project URL and publishable (or legacy `anon`) key.
2. In the Supabase SQL Editor, run `supabase/migrations/202610190001_initial_schema.sql`.
3. In **Authentication → Users**, create the owner account. This app intentionally has no public sign-up screen. Disable new user sign-ups in **Authentication → Settings** after creating the owner.
4. Copy `.env.example` to `.env.local` and enter the Supabase project URL and publishable/anon key. These are public client configuration values, not service-role secrets. Never put a service-role key in this app.
5. Install and run:

   ```sh
   npm install
   npm run dev
   ```

The migration creates the sales, spending, inventory and owner settings tables, indexes, row-level security policies, and an owner-scoped reset function. It starts empty; no sample or financial data is included.

## GitHub Pages deployment

The included workflow builds and deploys the site from `main` to GitHub Pages. In repository **Settings → Pages**, select **GitHub Actions** as the build and deployment source. Add these Actions repository secrets before deploying:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Because Vite embeds these client values in the public bundle, only use the Supabase publishable/anon key. RLS is the security boundary, not secrecy of this key. The workflow uses `/reignholdings/` as the project-site base path. For a different repository name or a custom domain at the root, update `base` in `vite.config.ts`.

In Supabase **Authentication → URL Configuration**, add the deployed Pages URL to the allowed redirect URLs. Create the owner in the dashboard and use those credentials to sign in. GitHub Pages deployment and Supabase provisioning require access to the owner's GitHub and Supabase projects and are not performed by this repository alone.

## Features

- Owner sign-in and sign-out through Supabase Auth
- Sales by Furniture, Carpets and Upholstery, with recent-entry editing and deletion
- Stock quantity and value tracking, grouped by source
- Savings target and editable 100% income split across Savings, Expenses and Restocking
- Searchable spending history, bucket budgets and remaining balances
- Period-based profit & loss, print view and CSV export
- Confirmed reset of this owner's data and settings

## Checks

```sh
npm run build
```
