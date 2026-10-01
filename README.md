# feature-testing

Automated feature tests (Playwright + TypeScript) for Paramount web applications. Each feature under test gets its own spec, named after its Jira card.

## Project structure

```
.github/workflows/   CI pipeline
tests/               Playwright specs
playwright.config.ts Shared test configuration
```

## Naming convention

Specs are named `[JIRA_CARD] - [Date of Testing].spec.ts`, for example `QB-49 - 2026-10-01.spec.ts`.

## Getting started

Requires Node.js 20+.

```bash
npm ci
npx playwright install chrome msedge
```

## Running tests

```bash
npm test                                   # all specs, headless
npm run test:headed                        # watch the browser
npx playwright test "tests/<spec file>"    # a single spec
npm run report                             # open the last HTML report
```

## CI/CD

GitHub Actions (`.github/workflows/playwright.yml`) runs the suite on pushes and pull requests to `main`, on a weekday schedule, and on demand via **Actions → Run workflow** (optional spec filter). Tests run headless on Chrome and Edge; the HTML report and traces are uploaded as a build artifact.

## Adding a new test

1. Add `tests/<JIRA_CARD> - <YYYY-MM-DD>.spec.ts`.
2. Run it locally, then push. CI picks it up automatically.

## Running a single set and generating the report

The QB-49 spec is split into vehicle sets. `SET=1` runs Private Car plus the API/UI scenarios, `SET=2` Motorcycle, `SET=3` Commercial Vehicle (unset runs all).

```bash
SET=1 PLAYWRIGHT_JSON_OUTPUT_NAME=results.json npx playwright test "tests/QB-49 - 2026-10-01.spec.ts" --reporter=list,html,json
node scripts/gen-report.mjs results.json "Set 1 Private Car" "reports/QB-49 - 2026-10-01 - Set 1 Private Car"
```

`gen-report.mjs` writes `summary.md` and `summary.html` with Test Status, Expected Output, System Output and Test Remarks per test. Reports live under `reports/`.
