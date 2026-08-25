# GeriCare deployment architecture

Production uses one GitHub monorepo, one Netlify site, and one Supabase project.

- `/` — participant quiz
- `/control/` — Control Room
- `/projector/` — auditorium projector
- `/admin/` — Admin Console

The root `pnpm build:site` command builds all four apps and assembles `site-dist/` for Netlify.
