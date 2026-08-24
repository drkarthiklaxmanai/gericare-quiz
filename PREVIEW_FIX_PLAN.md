# Participant blank-screen preview

This branch is intended for Netlify Deploy Preview testing only.

Key safeguards:
- Root `netlify.toml` explicitly builds `@gericare/participant` and publishes `apps/participant/dist`.
- Participant HTML includes a visible startup fallback so a JavaScript load/runtime failure does not appear as a completely blank page.
- Production is not changed until this preview is verified.
