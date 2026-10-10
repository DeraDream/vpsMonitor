# VPS Monitor v1.9.9

## Highlights

- Adds DMIT catalogue discovery with region, route, and hardware filters.
- Refreshes unmonitored provider catalogues in the background every two minutes.
- Keeps provider catalogue jobs independent so a slow provider cannot delay DMIT.

## Verification

- `npm test`
- `npm run check`
- `npm run build:web`
- `npm run package:release`
