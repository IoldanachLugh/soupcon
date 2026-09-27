# Instructions for Claude

At the start of any session in this repo, before making changes, read:

1. **`README.md`** — what the app does, how it's built, project structure.
2. **`CONTEXT.md`** — infrastructure, deployment, decisions made and why,
   known gotchas, shelved work. Anything not obvious from the code alone
   lives here. Read this before touching deployment, the service worker,
   or anything infrastructure-related.
3. **`PLAN.md`** — a code-review findings/fix list for the original FRTCON
   codebase, **superseded** by the SOUPCON rebuild (see its own banner
   note). Most of what it references no longer exists in this repo. Kept
   for historical record, not as a guide to current structure — don't
   re-derive decisions from it without checking whether `SOUP_PLAN.md`
   already superseded that area.
4. **`SOUP_PLAN.md`** — the current running plan (same "Done:"-note
   convention as `PLAN.md` had): the FRTCON → SOUPCON rebrand/rebuild,
   worked one item at a time. Read its "Decisions locked in" section and
   each item's **Done:** note before re-touching an area it already
   covers, so you don't redo work or reverse a deliberate decision (e.g.
   the rain/cloud keyword lists, the palette choice, or what's
   deliberately deferred to a later item). Unmarked items are still open.

## Keeping these in sync

When a change makes something in `README.md` or `CONTEXT.md` inaccurate,
update it as part of that change, not as separate cleanup later. When
fixing or deciding against something from `SOUP_PLAN.md`, mark it and add a
**Done:** note the same way the existing entries do (what changed, how it
was verified, anything explicitly left out of scope). `PLAN.md` itself is
frozen/historical — don't add new entries to it.
