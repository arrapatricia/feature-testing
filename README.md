# feature-testing

Playwright scripts for testing new features per Jira card.

## Naming convention

`tests/[JIRA_CARD] - [Date of Testing].spec.ts` (e.g. `QB-49 - 2026-10-01.spec.ts`)

## Test log

| Card | Date | Feature | Dev ticket |
|------|------|---------|------------|
| [QB-49](https://paramountdirect.atlassian.net/browse/QB-49) | 2026-10-01 | CTPL Web Service Update: COV charge (₱60 → ₱74) & VVIP auto opt-in, region dropdown | [RD-184](https://paramountdirect.atlassian.net/browse/RD-184) |

## Setup

```bash
npm install
npx playwright install
```

## Run

```bash
npx playwright test "tests/QB-49 - 2026-10-01.spec.ts"
```

## CI/CD

GitHub Actions (`.github/workflows/playwright.yml`) runs on push/PR to `main`, weekdays on a schedule, and manually via **Actions → Run workflow** (optional spec filter). It runs headless Chromium and uploads the HTML report and traces as an artifact.

Locally: `npm test` (headed off in CI only), `npm run test:headed`, `npm run report`.
