# Updated Trading Bot Patch

This patch fixes the backend risk/confirmation issues and adds responsive mobile dashboard support.

## Replace these files

Copy each file below into the matching path in your project, replacing the existing file:

- `artifacts/api-server/src/lib/riskManager.ts`
- `artifacts/api-server/src/lib/botRunner.ts`
- `artifacts/dashboard/src/components/layout.tsx`
- `artifacts/dashboard/src/pages/dashboard.tsx`
- `artifacts/dashboard/src/pages/trades.tsx`
- `artifacts/dashboard/src/pages/performance.tsx`

## Backend fixes included

- Uses Capital.com actual units for Silver, Gold, and Forex sizing.
- Keeps Bitcoin and Ethereum sizing unchanged.
- Raises Silver, Gold, and Forex maximum unit caps.
- Widens the Silver minimum stop distance from 0.2% to 0.5%.
- Inserts a trade only when Capital.com confirmation status is exactly `ACCEPTED`.
- Existing historical database records are not modified.

## Mobile dashboard fixes included

- Adds a sticky mobile header with bot status and start/stop controls.
- Adds horizontally scrollable mobile navigation.
- Prevents the page from becoming wider than the phone viewport.
- Makes live-position, trade-history, and market-breakdown tables scroll inside their cards.
- Uses smaller phone-safe spacing and chart sizing.

No database migration or dependency installation is required.
