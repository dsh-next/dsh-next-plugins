# Checkpoints GitHub-style diffstat

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

File list rows, the Files header, and the file-preview header now share one
GitHub-style diffstat: green `+N` / red `-N` (en-US grouping) plus a five-block
bar. Ratios floor so a tiny side does not steal a cell (4,801 / 66 → four
green, one empty). Preview header: path, then time + diffstat immediately left
of Close.

Surfaces: Files pane, file rows, preview dialog. Token set: success/error
primary for numbers and filled cells, module-platform for empty cells, code
font 12/18. Geometry: 8px cells, 2px gap, 2px radius (deviation: chrome
radius floor is 4px, which would circle an 8px cell). Dictionary: `files.statAria`.
