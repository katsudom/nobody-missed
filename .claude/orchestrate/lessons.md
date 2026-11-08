# Lessons

One line each, newest last: `YYYY-MM-DD - what went wrong or surprised us - what to do instead`.
Agents read this before planning; keep it short and prune what stopped being true.

- 2026-11-07: My shell is a sandbox with its own AppData; the user's spacetime login/install was invisible to it. Run login-bound commands (publish, owner reducers) in the user's terminal via run_in_terminal; `spacetime call` there needs `--no-config` or spacetime.local.json picks the wrong db.
- 2026-11-07: A teammate one-shot every board ticket in one PR; tickets were dropped for "one area per person". Expect Claude-powered teammates to overreach: give areas, not tickets.
- 2026-11-07: Shared Maincloud db + unauthenticated buttons = someone injected 20k rows. Gate destructive/demo reducers server-side (admin table) on day one.
