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
