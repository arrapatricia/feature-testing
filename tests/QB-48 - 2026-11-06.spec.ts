import { test, expect, type APIRequestContext, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * QB-48 | Testing: Non-Life Production Inquiry (NLPI) APIs - PSNL
 *   Renewal List + Risk Description (ISD: WIN-1396 QA / WIN-1388 dev, GAService PR #67)
 *   Policy List by Agent + Policy Detail (ISD: WIN-1381 / PR #70)
 * Test date: 2026-11-06
 * Env: UAT  http://ws.paramount.com.ph/test/WorkflowService.svc  (http only - https returns 404 for this route)
 *
 * Methods under test (PSNL public key):
 *   GET /{publicKey}/nlife/policy/renewal/list?expd={yyyy-MM-dd}   - ready-for-renewal policies, expiry today-60 .. today+90
 *   GET /{publicKey}/nlife/policy/renewal/riskdesc?p={policyNo}    - risk description text for the renewal notice
 *   GET /{publicKey}/nlife/policy/list/byagent?agentCode=&pGroupCode=&pLineCode=&pageSize=&pageNumber=
 *   GET /{publicKey}/nlife/policy/detail?policyNumber=
 * Optional test data: QB48_AGENT_CODE (default 501), QB48_GROUP (30), QB48_LINE (7), QB48_POLICY (F-0000307634)
 *
 * Authentication-Hash = UPPERCASE hex of SHA256( UTF8( privateKey + lowercase(path + query) ) )
 *   (confirmed with dev - the private key is NOT lowercased and the hex must be uppercase)
 *
 * Secrets are never committed. Set them before running:
 *   PowerShell:  $env:PSNL_PRIVATE_KEY = "<guid>"
 *   bash:        export PSNL_PRIVATE_KEY=<guid>
 * Optional:     PSNL_BASE_URL (default http://ws.paramount.com.ph/test), PSNL_SERVICE_HOST (default WorkflowService)
 *
 * The UAT server is internal, so run this locally (on VPN / office network). Without PSNL_PRIVATE_KEY every test is skipped,
 * which keeps the GitHub Actions run green. API tests run once (Google Chrome project only) - no browser is used.
 *
 * Proof (response JSON + summary CSV) is written to reports/QB-48 - 2026-11-06/data.
 */

test.setTimeout(240000);

const BASE_URL = (process.env.PSNL_BASE_URL || 'http://ws.paramount.com.ph/test').replace(/\/+$/, '');
const SERVICE_HOST = process.env.PSNL_SERVICE_HOST || 'WorkflowService';
const PUBLIC_KEY = 'psnl';
const PRIVATE_KEY = process.env.PSNL_PRIVATE_KEY || '';

const ORIGIN = new URL(BASE_URL).origin;
const BASE_PATH = new URL(BASE_URL).pathname.replace(/\/+$/, '');
const svc = (pub = PUBLIC_KEY) => `${BASE_PATH}/${SERVICE_HOST}.svc/${pub}`;
const LIST = (pub = PUBLIC_KEY) => `${svc(pub)}/nlife/policy/renewal/list`;
const RISK = `${svc()}/nlife/policy/renewal/riskdesc`;
const BYAGENT = `${svc()}/nlife/policy/list/byagent`;
const DETAIL = `${svc()}/nlife/policy/detail`;
const AGENT = process.env.QB48_AGENT_CODE || '501';
const GROUP = process.env.QB48_GROUP || '30';
const LINE = process.env.QB48_LINE || '7';
const POLICY = process.env.QB48_POLICY || 'F-0000307634';

const REPORT_DIR = path.join(process.cwd(), 'reports', 'QB-48 - 2026-11-06', 'data');
const summary: string[][] = [['ID', 'Scenario', 'Request', 'Expected', 'HTTP', 'StatusCode', 'Count', 'Time (ms)', 'StatusDescription']];

const OUT_OF_WINDOW = 'must be within 60 days before today through 90 days after today';
const NOT_A_DATE = 'is not a valid date';
const UNAUTHORIZED = 'not authorized';

// ---------------------------------------------------------------- helpers
const hashFor = (pathAndQuery: string, key = PRIVATE_KEY) =>
  createHash('sha256').update(key + pathAndQuery.toLowerCase(), 'utf8').digest('hex').toUpperCase();

/** yyyy-MM-dd for today + n days, Asia/Manila (server time), so the window matches the server's "today". */
function day(n: number): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // shift to UTC+8, then read UTC parts
  now.setUTCDate(now.getUTCDate() + n);
  return now.toISOString().slice(0, 10);
}

type Envelope = { StatusCode: number; StatusDescription: string | null; ResponseData: any; Exception: any };
type Call = { http: number; body: Envelope; ms: number };

async function call(
  request: APIRequestContext,
  pathAndQuery: string,
  opts: { skipAuth?: boolean; hash?: string; key?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = {};
  if (!opts.skipAuth) headers['Authentication-Hash'] = opts.hash ?? hashFor(pathAndQuery, opts.key);
  const t0 = Date.now();
  const res = await request.get(ORIGIN + pathAndQuery, { headers, timeout: 180000, failOnStatusCode: false });
  const ms = Date.now() - t0;
  const text = await res.text();
  let body: Envelope;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status()} - response is not JSON: ${text.slice(0, 200)}`);
  }
  return { http: res.status(), body, ms };
}

function record(testInfo: TestInfo, id: string, scenario: string, req: string, expected: string, c: Call) {
  const count = c.body?.ResponseData?.count ?? '';
  const actual = `HTTP ${c.http}, StatusCode ${c.body.StatusCode}${count !== '' ? `, count ${count}` : ''}, ${c.ms} ms - ${c.body.StatusDescription ?? ''}`;
  testInfo.annotations.push({ type: 'expected', description: expected }, { type: 'actual', description: actual });
  summary.push([id, scenario, req, expected, String(c.http), String(c.body.StatusCode), String(count), String(c.ms), String(c.body.StatusDescription ?? '')]);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify({ request: req, http: c.http, ms: c.ms, response: c.body }, null, 2));
  console.log(`${id} | ${scenario} | ${actual}`);
}

/** Shared checks for every 200 list reply (Post-response script in WIN-1396). */
function expectValidList(c: Call, exactDate?: string) {
  expect(c.body.StatusCode).toBe(200);
  expect(c.body.Exception).toBeNull();
  const rd = c.body.ResponseData;
  expect(Array.isArray(rd.data), 'data is an array (never null)').toBe(true);
  expect(rd.count, 'count = data.length').toBe(rd.data.length);
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const lo = day(-60), hi = day(90);
  for (const p of rd.data) {
    expect(p.expiration_date, `${p.policy_number} expiration_date format`).toMatch(ymd);
    expect(p.expiration_date >= lo && p.expiration_date <= hi, `${p.policy_number} ${p.expiration_date} within ${lo}..${hi}`).toBe(true);
    if (p.date_issued !== null) expect(p.date_issued, `${p.policy_number} date_issued format`).toMatch(ymd);
    if (exactDate) expect(p.expiration_date, `${p.policy_number} matches expd`).toBe(exactDate);
  }
  return rd.data as any[];
}

function expectError(c: Call, status: number, msg?: string) {
  expect(c.body.StatusCode).toBe(status);
  expect(c.body.ResponseData).toBeNull();
  expect(c.body.Exception).toBeNull();
  if (msg) expect(String(c.body.StatusDescription)).toContain(msg);
}

// ---------------------------------------------------------------- suite
let sample: any = null; // a policy taken from the renewal list, reused by C1 / R1 / D-checks
let pickedPolicy = ''; // a policy taken from the agent list, reused by PD2

test.describe.serial('QB-48 PSNL - NLPI APIs', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Google Chrome', 'API tests run once (Chrome project only).');
    test.skip(!PRIVATE_KEY, 'PSNL_PRIVATE_KEY is not set - see header comment.');
  });

  test.afterAll(async () => {
    if (summary.length < 2) return;
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const csv = summary.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    fs.writeFileSync(path.join(REPORT_DIR, 'summary.csv'), csv);
  });

  // ================================================================ A. Authentication
  test.describe('A. Authentication', () => {
    const q = () => `${LIST()}?expd=${day(0)}`;

    test('A1 Valid auth - 200 OK', async ({ request }, testInfo) => {
      const c = await call(request, q());
      record(testInfo, 'A1', 'Valid auth', q(), '200 OK', c);
      const data = expectValidList(c, day(0));
      if (data.length) sample = data[0];
    });

    test('A2 Missing Authentication-Hash header - 401', async ({ request }, testInfo) => {
      const c = await call(request, q(), { skipAuth: true });
      record(testInfo, 'A2', 'Missing header', q(), '401 Unauthorized, ResponseData null, Exception null', c);
      expectError(c, 401, UNAUTHORIZED);
    });

    test('A3 Tampered hash (64 zeros) - 401', async ({ request }, testInfo) => {
      const c = await call(request, q(), { hash: '0'.repeat(64) });
      record(testInfo, 'A3', 'Tampered hash', q(), '401 Unauthorized', c);
      expectError(c, 401, UNAUTHORIZED);
    });

    test('A4 Wrong private key - 401', async ({ request }, testInfo) => {
      const c = await call(request, q(), { key: '00000000-1111-2222-3333-444444444444' });
      record(testInfo, 'A4', 'Wrong private key', q(), '401 Unauthorized', c);
      expectError(c, 401, UNAUTHORIZED);
    });

    test('A5 Wrong public key (xxxx) - 401', async ({ request }, testInfo) => {
      const p = `${LIST('xxxx')}?expd=${day(0)}`;
      const c = await call(request, p);
      record(testInfo, 'A5', 'Wrong public key', p, '401 Unauthorized', c);
      expectError(c, 401, UNAUTHORIZED);
    });

    test('A6 Uppercase PSNL in URL - same as A1 (hash input is lowercased)', async ({ request }, testInfo) => {
      const p = `${LIST('PSNL')}?expd=${day(0)}`;
      const c = await call(request, p);
      record(testInfo, 'A6', 'Uppercase PSNL in URL', p, '200 OK', c);
      expectValidList(c, day(0));
    });
  });

  // ================================================================ B. No filter
  test.describe('B. No filter', () => {
    test('B1/B2 Full list - every expiration_date in window, count = data.length', async ({ request }, testInfo) => {
      const c = await call(request, LIST());
      record(testInfo, 'B1', 'Full list (no expd)', LIST(), `200 OK, all expiration_date between ${day(-60)} and ${day(90)}, count = data.length`, c);
      const data = expectValidList(c);
      if (data.length) sample = data[Math.floor(data.length / 2)];
      // D3/D4 observations - logged for the manual spot-check, not asserted
      const nullBranch = data.filter(p => p.branch_name === null).length;
      const nullEmail = data.filter(p => p.insured_email === null).length;
      const nullIssued = data.filter(p => p.date_issued === null).length;
      const facilIsAgent = data.filter(p => p.facilitator_code === p.agent_code).length;
      testInfo.annotations.push({
        type: 'observation',
        description: `count=${data.length}; null branch_name=${nullBranch}; null insured_email=${nullEmail}; null date_issued=${nullIssued}; facilitator_code=agent_code on ${facilIsAgent}`,
      });
    });
  });

  // ================================================================ C. expd filter
  test.describe('C. expd filter', () => {
    test('C1 Date with matches - every item has that expiration_date', async ({ request }, testInfo) => {
      test.skip(!sample, 'No policy returned by A1/B1 to take a date from.');
      const d = sample.expiration_date as string;
      const p = `${LIST()}?expd=${d}`;
      const c = await call(request, p);
      record(testInfo, 'C1', `Date with matches (${d})`, p, `200 OK, every item expiration_date = ${d}`, c);
      const data = expectValidList(c, d);
      expect(data.length).toBeGreaterThan(0);
    });

    for (const [id, label, n] of [['C3', 'Lower boundary (today-60)', -60], ['C4', 'Upper boundary (today+90)', 90]] as const) {
      test(`${id} ${label} - 200`, async ({ request }, testInfo) => {
        const p = `${LIST()}?expd=${day(n)}`;
        const c = await call(request, p);
        record(testInfo, id, `${label} ${day(n)}`, p, '200 OK', c);
        expectValidList(c, day(n));
      });
    }

    for (const [id, label, n] of [['C5', 'Just below window (today-61)', -61], ['C6', 'Just above window (today+91)', 91]] as const) {
      test(`${id} ${label} - 403`, async ({ request }, testInfo) => {
        const p = `${LIST()}?expd=${day(n)}`;
        const c = await call(request, p);
        record(testInfo, id, `${label} ${day(n)}`, p, `403 "${OUT_OF_WINDOW}"`, c);
        expectError(c, 403, OUT_OF_WINDOW);
      });
    }

    test('C7 Invalid date 2026-02-30 - 403', async ({ request }, testInfo) => {
      const p = `${LIST()}?expd=2026-02-30`;
      const c = await call(request, p);
      record(testInfo, 'C7', 'Invalid date 2026-02-30', p, `403 "${NOT_A_DATE}"`, c);
      expectError(c, 403, NOT_A_DATE);
    });

    test('C8 Not a date (abc) - 403', async ({ request }, testInfo) => {
      const p = `${LIST()}?expd=abc`;
      const c = await call(request, p);
      record(testInfo, 'C8', 'Not a date (abc)', p, `403 "${NOT_A_DATE}"`, c);
      expectError(c, 403, NOT_A_DATE);
    });

    test('C9 Other format 10/01/2026 - record result (expected 403)', async ({ request }, testInfo) => {
      const p = `${LIST()}?expd=10%2F01%2F2026`;
      const c = await call(request, p);
      record(testInfo, 'C9', 'Other format 10/01/2026', p, '403 (if 200, log for dev review)', c);
      if (c.body.StatusCode !== 403) testInfo.annotations.push({ type: 'remark', description: `Returned ${c.body.StatusCode} - log for dev review.` });
      expect.soft(c.body.StatusCode).toBe(403);
    });

    test('C10 Empty expd - record result (expected to behave like B1)', async ({ request }, testInfo) => {
      const p = `${LIST()}?expd=`;
      const c = await call(request, p);
      record(testInfo, 'C10', 'Empty expd', p, '200 OK, same as no filter', c);
      if (c.body.StatusCode !== 200) testInfo.annotations.push({ type: 'remark', description: `Returned ${c.body.StatusCode} - log for dev review.` });
      expect.soft(c.body.StatusCode).toBe(200);
    });
  });

  // ================================================================ R. Risk description (policy detail for the renewal notice)
  test.describe('R. Risk description', () => {
    test('R1 Risk description for a listed policy - 200, text', async ({ request }, testInfo) => {
      test.skip(!sample, 'No policy returned by the list to look up.');
      const p = `${RISK}?p=${encodeURIComponent(sample.policy_number)}`;
      const c = await call(request, p);
      record(testInfo, 'R1', `Risk description for ${sample.policy_number}`, p, '200 OK, ResponseData is a string', c);
      expect(c.body.StatusCode).toBe(200);
      expect(typeof c.body.ResponseData).toBe('string');
      testInfo.annotations.push({ type: 'observation', description: `Risk description: ${String(c.body.ResponseData).replace(/\n/g, ' / ')}` });
    });

    test('R2 Missing p - 403', async ({ request }, testInfo) => {
      const c = await call(request, RISK);
      record(testInfo, 'R2', 'Risk description, p missing', RISK, '403 Forbidden', c);
      expectError(c, 403);
    });
  });


  // ================================================================ P. Policy List by Agent
  test.describe('P. Policy List by Agent', () => {
    const headerKeys = ['policy_number', 'product_group_code', 'product_group', 'product_line_code', 'product_line', 'inception_date',
      'expiry_date', 'policy_status', 'agent_code', 'agent_name', 'branch_code', 'branch_name', 'client_code', 'corp_name',
      'first_name', 'middle_name', 'last_name', 'tsi', 'net_premium', 'gross_premium', 'commission'];

    function expectPolicyList(c: Call, filters: { group?: string; line?: string } = {}) {
      expect(c.body.StatusCode).toBe(200);
      expect(c.body.Exception).toBeNull();
      const rd = c.body.ResponseData;
      expect(Array.isArray(rd.data), 'data is an array').toBe(true);
      expect(rd.count, 'count is the total across all pages (>= this page)').toBeGreaterThanOrEqual(rd.data.length);
      for (const p of rd.data) {
        for (const k of headerKeys) expect(Object.keys(p), `${p.policy_number} has ${k}`).toContain(k);
        expect(Object.keys(p), `${p.policy_number} pol_perils omitted on list (payload optimization)`).not.toContain('pol_perils');
        expect(String(p.agent_code), `${p.policy_number} agent_code`).toBe(String(Number(AGENT)));
        if (filters.group) expect(String(p.product_group_code)).toBe(String(Number(filters.group)));
        if (filters.line) expect(String(p.product_line_code)).toBe(String(Number(filters.line)));
        expect(['NEW', 'REN', 'END', 'CAN', 'SPL', 'E', ''], `${p.policy_number} policy_status`).toContain(String(p.policy_status ?? '').trim());
        expect(String(p.inception_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(String(p.expiry_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      return rd.data as any[];
    }

    test('P1 Agent code only - 200, pol_perils omitted', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?agentCode=${AGENT}`;
      const c = await call(request, p);
      record(testInfo, 'P1', `Agent only (${AGENT})`, p, '200 OK, list of PSNLPolicyHeader, pol_perils omitted', c);
      const data = expectPolicyList(c);
      expect(data.length, 'default page size 500').toBeLessThanOrEqual(500);
      // Client formatting observation (corporate vs individual)
      const corp = data.filter(x => !x.first_name && !x.last_name).length;
      testInfo.annotations.push({ type: 'observation', description: `count=${c.body.ResponseData.count}, page rows=${data.length}, corporate-style (no first/last name)=${corp}` });
    });

    test('P2 Agent + PGroupCode - 200, all rows in group', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?agentCode=${AGENT}&pGroupCode=${GROUP}`;
      const c = await call(request, p);
      record(testInfo, 'P2', `Agent + group ${GROUP}`, p, `200 OK, every product_group_code = ${GROUP}`, c);
      expectPolicyList(c, { group: GROUP });
    });

    test('P3 Agent + PGroupCode + PLineCode - 200, all rows in group/line', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?agentCode=${AGENT}&pGroupCode=${GROUP}&pLineCode=${LINE}`;
      const c = await call(request, p);
      record(testInfo, 'P3', `Agent + group ${GROUP} + line ${LINE}`, p, `200 OK, every row group ${GROUP} / line ${LINE}`, c);
      const data = expectPolicyList(c, { group: GROUP, line: LINE });
      if (data.length) pickedPolicy = data[0].policy_number;
    });

    test('P4 Missing agentCode - validation error', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?pGroupCode=${GROUP}`;
      const c = await call(request, p);
      record(testInfo, 'P4', 'agentCode missing', p, 'Error (QB-48 expects 400; docs list 403 "Agent Code is not numeric.")', c);
      expect([400, 403]).toContain(c.body.StatusCode);
      expect(c.body.ResponseData).toBeNull();
    });

    test('P5 PLineCode without PGroupCode - 400', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?agentCode=${AGENT}&pLineCode=${LINE}`;
      const c = await call(request, p);
      record(testInfo, 'P5', 'pLineCode without pGroupCode', p, '400 "Product Group Code is required when Product Line Code is provided."', c);
      expect(c.body.StatusCode).toBe(400);
      expect(String(c.body.StatusDescription)).toContain('Product Group Code is required');
    });

    for (const [id, field, q, msg] of [
      ['P6', 'agentCode', `agentCode=abc`, 'Agent Code is not numeric'],
      ['P7', 'pGroupCode', `agentCode=${AGENT}&pGroupCode=abc`, 'Product Group Code is not numeric'],
      ['P8', 'pLineCode', `agentCode=${AGENT}&pGroupCode=${GROUP}&pLineCode=abc`, 'Product Line Code is not numeric'],
    ] as const) {
      test(`${id} Non-numeric ${field} - 403`, async ({ request }, testInfo) => {
        const p = `${BYAGENT}?${q}`;
        const c = await call(request, p);
        record(testInfo, id, `Non-numeric ${field}`, p, `403 "${msg}"`, c);
        expectError(c, 403, msg);
      });
    }

    test('P9 pageSize above max (5000) is capped at 1000', async ({ request }, testInfo) => {
      const p = `${BYAGENT}?agentCode=${AGENT}&pageSize=5000`;
      const c = await call(request, p);
      record(testInfo, 'P9', 'pageSize=5000', p, '200 OK, at most 1000 rows', c);
      expect(c.body.StatusCode).toBe(200);
      expect(c.body.ResponseData.data.length).toBeLessThanOrEqual(1000);
    });

    test('P10 Paging - page 2 does not repeat page 1', async ({ request }, testInfo) => {
      const p1 = `${BYAGENT}?agentCode=${AGENT}&pageSize=5&pageNumber=1`;
      const p2 = `${BYAGENT}?agentCode=${AGENT}&pageSize=5&pageNumber=2`;
      const c1 = await call(request, p1);
      const c2 = await call(request, p2);
      record(testInfo, 'P10', 'Paging pageSize=5, pages 1 and 2', `${p1} | ${p2}`, '200 OK, same count, no overlapping policy numbers', c2);
      expect(c1.body.StatusCode).toBe(200);
      expect(c2.body.StatusCode).toBe(200);
      expect(c2.body.ResponseData.count).toBe(c1.body.ResponseData.count);
      const a = new Set(c1.body.ResponseData.data.map((x: any) => x.policy_number));
      for (const x of c2.body.ResponseData.data) expect(a.has(x.policy_number), `${x.policy_number} repeated on page 2`).toBe(false);
    });
  });

  // ================================================================ PD. Policy Detail
  test.describe('PD. Policy Detail', () => {
    test('PD1 Valid policy number - 200, pol_perils populated', async ({ request }, testInfo) => {
      const p = `${DETAIL}?policyNumber=${encodeURIComponent(POLICY)}`;
      const c = await call(request, p);
      record(testInfo, 'PD1', `Detail ${POLICY}`, p, '200 OK, single PSNLPolicyHeader with pol_perils array (perils, commission, tsi, pratsi)', c);
      expect(c.body.StatusCode).toBe(200);
      const h = c.body.ResponseData;
      expect(Array.isArray(h), 'single object, not a list').toBe(false);
      expect(Array.isArray(h.pol_perils), 'pol_perils is an array').toBe(true);
      for (const pr of h.pol_perils) {
        for (const k of ['perils', 'commission', 'tsi', 'pratsi']) expect(Object.keys(pr)).toContain(k);
        expect(['Y', 'N']).toContain(String(pr.pratsi).trim());
      }
      // TSI vs PRATSI = Y (observation - header tsi should equal the sum of perils with pratsi = Y)
      const sumY = h.pol_perils.filter((x: any) => String(x.pratsi).trim() === 'Y').reduce((a: number, x: any) => a + Number(x.tsi), 0);
      testInfo.annotations.push({ type: 'observation', description: `header tsi=${h.tsi}; sum of peril tsi where pratsi=Y = ${sumY}; perils=${h.pol_perils.length}` });
      expect.soft(Math.abs(Number(h.tsi) - sumY), 'header tsi = sum of peril tsi (pratsi = Y)').toBeLessThan(0.01);
    });

    test('PD2 Policy from the agent list - 200', async ({ request }, testInfo) => {
      test.skip(!pickedPolicy, 'P3 returned no policy.');
      const p = `${DETAIL}?policyNumber=${encodeURIComponent(pickedPolicy)}`;
      const c = await call(request, p);
      record(testInfo, 'PD2', `Detail for listed ${pickedPolicy.trim()}`, p, '200 OK', c);
      expect(c.body.StatusCode).toBe(200);
      expect(c.body.ResponseData.policy_number.trim()).toBe(pickedPolicy.trim());
    });

    for (const [id, label, val, status] of [
      ['PD3', 'Missing policyNumber', null, 403],
      ['PD4', 'Missing dash (F0000307634)', 'F0000307634', 403],
      ['PD5', 'Too short (F-12345)', 'F-12345', 403],
      ['PD6', 'Too long (FIRE-00000000307634)', 'FIRE-00000000307634', 403],
      ['PD7', 'Prefix starts with digit (1-0000307634)', '1-0000307634', 403],
      ['PD8', 'Well-formed but unknown (F-9999999999)', 'F-9999999999', 404],
    ] as const) {
      test(`${id} ${label} - ${status}`, async ({ request }, testInfo) => {
        const p = val === null ? DETAIL : `${DETAIL}?policyNumber=${encodeURIComponent(val)}`;
        const c = await call(request, p);
        record(testInfo, id, label, p, `${status}`, c);
        expect(c.body.StatusCode).toBe(status);
        expect(c.body.ResponseData).toBeNull();
      });
    }
  });

  // ================================================================ D. Data checks (sample shown for manual verification in UAT)
  test.describe('D. Data checks', () => {
    test('D1-D5 Sample policy fields are populated (verify against UAT manually)', async ({}, testInfo) => {
      test.skip(!sample, 'No policy returned by the list.');
      for (const k of ['policy_number', 'insured_name', 'expiration_date', 'product_group', 'product_line']) {
        expect(sample[k], `${k} is populated`).toBeTruthy();
      }
      for (const k of ['gross_premium', 'sum_insured', 'agent_code', 'facilitator_code', 'branch_code', 'product_group_code', 'product_line_code']) {
        expect(typeof sample[k], `${k} is a number`).toBe('number');
      }
      testInfo.annotations.push({ type: 'observation', description: `Sample for D1 spot-check: ${JSON.stringify(sample)}` });
    });
  });
});
