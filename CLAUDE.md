# Working on SOUPCON

> Shared for portfolio & demonstration purposes. All rights reserved.

This project was built with an AI pair programmer (Claude Code reads this
file automatically). The same notes apply to anyone picking up the code.

## Getting oriented

The docs are worth reading in this order:

1. **`README.md`** covers what the app does, how it's built, and how the
   project is laid out.
2. **`CONTEXT.md`** explains why things are the way they are: design
   decisions, hosting, lessons learned, and ideas set aside for later.
   Read it before changing deployment, the service worker, or anything
   else infrastructure-related.
3. **`SOUP_PLAN.md`** is the build log for the FRTCON → SOUPCON rebuild
   and all the work since, one numbered item at a time. If you're about
   to change an area it covers, read that item first. Several choices that
   look arbitrary were made on purpose, like the rain and cloud keyword
   lists, the color palette, and what was left out of scope.
4. **`FRTCON_PLAN.md`** is a code review of the original FRTCON app,
   written before the rebuild. Most of the files it mentions no longer
   exist. It's kept as history, so check `SOUP_PLAN.md` before relying on
   anything in it.

## Keeping the docs current

- If a change makes `README.md` or `CONTEXT.md` wrong, update them in the
  same change.
- New work goes in `SOUP_PLAN.md` as a numbered item, with a short note on
  what changed, how it was checked, and anything left out on purpose.
- `FRTCON_PLAN.md` is finished. Don't add to it.
