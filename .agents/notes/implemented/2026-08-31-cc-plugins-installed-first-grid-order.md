# cc-plugins: installed-first, alphabetical plugin grid ordering

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

Panel ordering follow-up to the version-display change: the Plugins tab
grid now lists installed plugins first, then the non-installed ones, with
each group sorted by plugin name ascending (locale-aware) and the
marketplace id as a stable tie-break when one name appears in two
marketplaces. Implemented in the panel's `filtered` memo (sort after
filtering), so search, the marketplace filter, and the installed-only
toggle keep the same ordering. Proven by a panel spec test that reads the
grid order through the Add/Manage button titles (plugin keys) with a
fixture whose marketplace index order deliberately disagrees with both
sort rules.
