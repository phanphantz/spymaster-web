# Snapshots

Written by `npm run snapshot -- --name <name>`. Each subdirectory is a complete, frozen copy of
every table, loadable with `?data=snapshot:<name>` and safe to edit by hand.

Commit one when an experiment is worth keeping; otherwise they are scratch.
