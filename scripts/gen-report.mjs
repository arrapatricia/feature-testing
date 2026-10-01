// Usage: node scripts/gen-report.mjs <results.json> <label> <outDir>
// Builds summary.md + summary.html (self-contained) from a Playwright JSON report:
// per test -> Test Status, Expected Output, System Output, Test Remarks.
import fs from 'node:fs';
import path from 'node:path';

const [, , resultsPath, label, outDir] = process.argv;
const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const strip = s => (s || '').replace(/\x1b\[[0-9;]*m/g, '');

const group_of = trail => trail.filter(x => x && !x.endsWith('.spec.ts')).join(' > ');
const rows = [];
(function walk(suite, trail) {
  for (const s of suite.suites || []) walk(s, [...trail, s.title]);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      if (!t.results.length) continue; // not run (filtered out by SET)
      const sm = group_of(trail).match(/\| (Set \d) /);
      if (sm && !label.startsWith(sm[1])) continue; // belongs to another vehicle set
      const r = t.results[t.results.length - 1] || {};
      const group = trail.filter(x => x && !x.endsWith('.spec.ts')).join(' > ');
      const ann = [...new Map((r.annotations || []).concat(t.annotations || []).map(a => [a.type + a.description, a])).values()];
      rows.push({
        group, title: spec.title,
        status: t.status === 'skipped' ? 'SKIPPED' : r.status === 'passed' ? 'PASSED' : r.status === 'timedOut' ? 'TIMED OUT' : 'FAILED',
        actualAnn: ann.filter(a => a.type === 'actual').map(a => a.description).join(' ; '),
        stdout: (r.stdout || []).map(o => o.text).join('').split('\n').filter(l => /Total Premium|TEST \d|COMPLETE/.test(l)).map(l => l.trim()).join(' / '),
        error: strip(r.error && r.error.message).split('\n').filter(l => l.trim() && !/^\s+at /.test(l)).slice(0, 6).join(' | ').slice(0, 400),
        duration: r.duration || 0,
      });
    }
  }
})({ suites: data.suites }, []);

// ---- Expected output (what the Jira conditions / test intend)
function expected(r) {
  const T = r.title, G = r.group;
  if (/in-scope .* charges COV P74/.test(T)) return 'Region is in the COV list: HTTP 200, enabled=true and fees[region] = "74.0" (additional P74 applied).';
  if (/not-in-COV/.test(T)) return 'Region is not in the COV list (QB-49 rule): HTTP 200 and NO additional P74 fee for the region (fee absent or 0).';
  if (/region option values map/.test(T)) return 'Each dropdown value maps to the expected region name (NCR, CAR, Region I ... BARMM).';
  if (/invalid region/.test(T)) return 'HTTP status < 500 and no fee returned (fees = {}).';
  if (/SQL-injection/.test(T)) return 'HTTP status < 500 and no fee returned; input must not resolve to a region.';
  if (/missing parameter/.test(T)) return 'HTTP status < 500 and no fee returned (fees = {}).';
  if (/never exposes a fee other than P74/.test(T)) return 'Every fee in every response equals "74.0".';
  if (/POST is not accepted/.test(T)) return 'POST rejected with 404 / 405 / 422.';
  if (/lists all 18 regions/.test(T)) return 'Dropdown shows placeholder "Select Region" plus 18 regions (19 options).';
  if (/COV notice states/.test(T)) return 'Notice states the COV has an additional P74 verification fee.';
  if (/no VVIP opt-in prompt/.test(T)) return 'No VVIP opt-in prompt/radio (#has_added_vfee) on the form; VVIP auto-applied.';
  if (/selecting an in-scope region/.test(T)) return 'Fee lookup returns fees["1"] = "74.0" and the Next button becomes enabled.';
  if (/Next is blocked until a region/.test(T)) return 'Next button disabled while no region is selected.';
  if (/resetting region/.test(T)) return 'Next enabled with a region, disabled again after resetting to the placeholder.';
  if (/returning 500/.test(T)) return 'Fee lookup error (HTTP 500) must not let the user proceed: Next disabled.';
  if (/empty fees/.test(T)) return 'Empty fee response must not let the user proceed: Next disabled.';
  if (/tampered fee/.test(T)) return 'A tampered P0 fee must not be accepted: Next disabled.';
  if (/re-queries the fee/.test(T)) return 'Fee endpoint called once per region change, in order: 1, 5, 10.';
  const m = G.match(/E \| (Set \d [^|]+?) \| (.+)$/);
  if (m) {
    if (/Application Process/.test(T)) return `Application for ${m[1].trim()} in ${m[2]} completes: no VVIP opt-in prompt, DPA accepted, OTP verified, redirected to payment instructions.`;
    if (/BDO Payment/.test(T)) return 'Payment instructions page proceeds through BDO sandbox payment to a successful payment (screenshot attached).';
    if (/Total Premium/.test(T)) return 'Total Premium = one-year base (rate table) + P74 verification fee for COV regions; base only for non-COV regions.';
  }
  return 'Assertions in the test pass.';
}

// ---- System output (what the system actually did)
function actual(r) {
  const bits = [];
  if (r.actualAnn) bits.push(r.actualAnn);
  if (r.stdout) bits.push(r.stdout);
  if (r.status === 'PASSED' && !bits.length) bits.push('Assertions passed; behavior matched expected.');
  if (r.status !== 'PASSED' && r.status !== 'SKIPPED') bits.push(r.error || 'Test did not complete.');
  if (r.status === 'SKIPPED') bits.push('Not executed (an earlier test in the serial flow did not complete).');
  return bits.join(' | ');
}

// ---- Remarks
function remarks(r) {
  if (r.status === 'PASSED') return 'As expected.';
  if (r.status === 'SKIPPED') return 'Blocked by a previous failure in the same flow.';
  if (/not-in-COV/.test(r.title))
    return 'FAILED vs QB-49 rule: region is not in the COV list but the system returns the additional P74. Per the dev code (ctpl#180) the fee comes from the region row in vvip_agent_regions (status / assignment / amount); this region is enrolled with P74 in this environment. Needs the region config corrected, or a code fix if it is not config.';
  if (/invalid region \((float|list)\)|SQL-injection/.test(r.title))
    return 'FINDING (low): malformed id is cast to an integer (e.g. "1.5" -> 1) and the region 1 fee is returned instead of being rejected. Not a 5xx and not an injection (the lookup is parameterised), but input is loosely validated.';
  if (/tampered fee/.test(r.title))
    return 'FINDING (low): UI keeps Next enabled when the fee response says P0. The dev doc says submission recalculates the fee on the server, so this is a display-only issue; confirm the server-side recalculation.';
  if (/Total Premium/.test(r.title) && /No-COV/.test(r.group))
    return 'FAILED vs QB-49 rule: CAR is not in the COV list, so only the base premium (606.00) should show. System shows base + P74 (680.00). Fee comes from the region config (vvip_agent_regions); CAR is enrolled with P74 in this environment.';
  if (/Total Premium/.test(r.title))
    return 'FAILED: Total Premium differs from base + P74. Check the rate table row used for this vehicle type.';
  return 'FAILED: see System Output. Needs investigation.';
}

const stats = rows.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
const overall = rows.every(r => r.status === 'PASSED') ? 'PASSED' : (rows.some(r => r.status === 'FAILED' || r.status === 'TIMED OUT') ? 'FAILED' : 'PARTIAL');
const date = new Date().toISOString().slice(0, 10);
const summaryLine = `${Object.entries(stats).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}; ${rows.length} total`;

// ---- Region coverage (from the API fee checks)
const coverage = [];
for (const r of rows) {
  const m = r.title.match(/^(in-scope|not-in-COV) (.+) \(id (\d+)\)/);
  if (!m) continue;
  const fee = (r.actualAnn.match(new RegExp('"' + m[3] + '":"([\\d.]+)"')) || [])[1];
  coverage.push({ rule: m[1] === 'in-scope' ? 'COV applies (+P74)' : 'NO COV (no additional P74)', region: m[2], id: m[3], fee: fee ? 'P' + fee : 'none', status: r.status });
}

fs.mkdirSync(outDir, { recursive: true });
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = x => String(x).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const color = { PASSED: '#1a7f37', FAILED: '#cf222e', 'TIMED OUT': '#cf222e', SKIPPED: '#9a6700' };
const NL = '\n';

// ---------- Markdown
let md = `# QB-49 | RD-184 - ${label}` + NL + NL
  + `- **Date of testing:** ${date}` + NL + '- **Environment:** https://ctpl-demo.herokuapp.com' + NL + '- **Browser:** Microsoft Edge' + NL
  + `- **Test Status:** ${overall} (${summaryLine})` + NL + NL;
md += '| # | Scenario | Test Status | Expected Output | System Output | Test Remarks |' + NL + '|---|---|---|---|---|---|' + NL;
rows.forEach((r, i) => { md += `| ${i + 1} | ${cell(r.group + ' > ' + r.title)} | ${r.status} | ${cell(expected(r))} | ${cell(actual(r))} | ${cell(remarks(r))} |` + NL; });
if (coverage.length) {
  md += NL + '## Region COV coverage' + NL + NL + 'Regions marked NO COV must not have the additional P74 verification fee.' + NL + NL;
  md += '| Region | Dropdown value | Rule (QB-49) | Fee returned by system | Result |' + NL + '|---|---|---|---|---|' + NL;
  coverage.forEach(c => { md += `| ${c.region} | ${c.id} | ${c.rule} | ${c.fee} | ${c.status} |` + NL; });
}
fs.writeFileSync(path.join(outDir, 'summary.md'), md);

// ---------- HTML
let html = `<!doctype html><meta charset="utf-8"><title>QB-49 ${esc(label)}</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:20px}td,th{border:1px solid #ccc;padding:6px 8px;vertical-align:top}th{background:#f3f3f3;text-align:left}.s{font-weight:700}</style>`;
html += `<h2>QB-49 | RD-184 - ${esc(label)}</h2><p><b>Date:</b> ${date} &nbsp; <b>Env:</b> https://ctpl-demo.herokuapp.com &nbsp; <b>Browser:</b> Microsoft Edge<br><b>Test Status:</b> <span class="s" style="color:${color[overall] || '#9a6700'}">${overall}</span> (${summaryLine})</p>`;
html += '<table><tr><th>#</th><th>Scenario</th><th>Test Status</th><th>Expected Output</th><th>System Output</th><th>Test Remarks</th></tr>';
rows.forEach((r, i) => { html += `<tr><td>${i + 1}</td><td>${esc(r.group)}<br><b>${esc(r.title)}</b></td><td class="s" style="color:${color[r.status]}">${r.status}</td><td>${esc(expected(r))}</td><td>${esc(actual(r))}</td><td>${esc(remarks(r))}</td></tr>`; });
html += '</table>';
if (coverage.length) {
  html += '<h3>Region COV coverage</h3><p>Regions marked <b>NO COV</b> must not have the additional P74 verification fee.</p>';
  html += '<table><tr><th>Region</th><th>Dropdown value</th><th>Rule (QB-49)</th><th>Fee returned by system</th><th>Result</th></tr>';
  coverage.forEach(c => { html += `<tr><td>${esc(c.region)}</td><td>${c.id}</td><td>${esc(c.rule)}</td><td>${c.fee}</td><td class="s" style="color:${color[c.status]}">${c.status}</td></tr>`; });
  html += '</table>';
}
fs.writeFileSync(path.join(outDir, 'summary.html'), html);
console.log(JSON.stringify({ overall, stats, total: rows.length }));
