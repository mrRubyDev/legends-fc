# Legends FC

Football 7 team app: players, matches, calendar, stats, post-match player ratings and FIFA-style cards.

- **Hosting:** GitHub Pages (static files, no build step).
- **Data:** Supabase, one table `legends_docs` (see `supabase/schema.sql`).
- **Players** open the site, pick a match, choose their name and rate teammates (votes open for 24 h after a match is saved). Every rating is stored.
- **Admin** taps **🔑 Admin** and enters the admin code to manage players, matches, the calendar and see the cards.

## Setup
1. Run `supabase/schema.sql` in the Supabase SQL editor (replace `CHANGE_ME` with your admin code).
2. Put the project URL and publishable key in `config.js`.
3. Push to `main`; GitHub Pages serves the root.

To change the admin code, re-run the `legends_is_admin` function from the schema with the new code.

## See all stored ratings
```sql
select id as voter, m.key as match_id, m.value as rating
from legends_docs, jsonb_each(data->'byMatch') m
where coll = 'votes';
```
