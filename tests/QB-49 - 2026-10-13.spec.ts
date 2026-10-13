import { test, expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import * as fs from 'fs';
import * as path from 'path';

/**
 * QB-49 | RD-184 - CTPL Web Service Update: COV charge adjustment & VVIP auto opt-in
 * Test date: 2026-10-13
 * Env: https://ctpl-demo.herokuapp.com
 *
 *  1. End-to-end, Private Car   - application, OTP, submit, BDO payment; premium 606.00 -> 680.00 (+74 COV)
 *  2. Premium per vehicle type  - base premium read from the site, then base + 74 after selecting a region
 *  3. Premium per region        - Private Car / Car, every region in the dropdown (CAR, Region I, BARMM = base only)
 *
 * Proof (screenshots, videos, CSVs) is written to reports/QB-49 - 2026-10-13/{screenshots,videos,data}.
 */

test.setTimeout(240000);

const REPORT_DIR = path.join(process.cwd(), 'reports', 'QB-49 - 2026-10-13');
const SUBDIR: Record<string, string> = { png: 'screenshots', webm: 'videos', csv: 'data' };
const proofPath = (name: string, ext: string) => {
  const dir = path.join(REPORT_DIR, SUBDIR[ext]);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.${ext}`);
};
const proofFile = (browser: string, label: string, ext: string) =>
  proofPath(`${browser}_${label}`.replace(/[^a-zA-Z0-9._-]+/g, '-'), ext);
async function proofShot(page: Page, browser: string, label: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: proofFile(browser, label, 'png') });
}

// Global variables
let paymentUrl = '';
let appliedFirstName = '';
let appliedLastName = '';

test.describe.serial('CTPL End-to-End Flow', () => {
  let page: Page; // Declare a shared page variable

  // Setup: Create a single page context that survives across all tests in this block
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  // Teardown: Close the page when all tests are finished
  test.afterAll(async ({}, testInfo) => {
    const video = page.video();
    await page.close();
    await video?.saveAs(proofFile(testInfo.project.name, 'e2e-flow-video', 'webm'));
  });

  // ====================================================================
  // TEST 1: APPLICATION PROCESS
  // Note: We leave the first parameter empty `{}` so we use our shared `page`
  // ====================================================================
  test('CTPL Website - Application Process', async ({}, testInfo) => {
    const URL = 'https://ctpl-demo.herokuapp.com/apply';

    const LAST_NAME = faker.person.lastName();
    const FIRST_NAME = faker.person.firstName();
    
    appliedFirstName = FIRST_NAME;
    appliedLastName = LAST_NAME;

    const HOUSE_NUMBER = faker.location.buildingNumber();
    const STREET_NAME = faker.location.street();
    const BUILDING_NAME = faker.company.name();
    const BARANGAY = 'Barangay 1';
    const PLATE_NUMBER = faker.string.alpha(3).toUpperCase() + faker.string.numeric(4); 
    const VEHICLE_COLOR = faker.color.human(); 
    const MV_FILE_NUM_1 = faker.string.numeric(4);
    const MV_FILE_NUM_2 = faker.string.numeric(7);
    const CHASSIS_NUMBER = faker.string.alphanumeric(17).toUpperCase();
    const ENGINE_NUMBER = faker.string.alphanumeric(12).toUpperCase();
    const EMAIL_ADDRESS = 'qatest0321@gmail.com';
    const MOBILE_NUM = '9171234567'; 
    const TELEPHONE_NUM = faker.string.numeric(7);

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const reminderModal = page.locator('.modal-content', { has: page.locator('h3.modal-title', { hasText: 'Reminder' }) });
    const closeReminderBtn = reminderModal.getByLabel('Close');
    await closeReminderBtn.waitFor({ state: 'visible', timeout: 15000 });
    await closeReminderBtn.click();

    await page.locator('#paramount_client_contact_info_email_address').fill(EMAIL_ADDRESS);
    await page.locator('#paramount_client_first_name').fill(FIRST_NAME);
    await page.locator('#paramount_client_surname').fill(LAST_NAME);
    await page.locator('#c2c_car_info_plate_number').fill(PLATE_NUMBER);
    await page.locator('#paramount_client_same_with_owner').selectOption({ label: 'Yes' });
    await page.locator('#btn-personal').click();
    
    await page.locator('#paramount_client_contact_info_address_number').waitFor({ state: 'visible' });
    await page.locator('#paramount_client_contact_info_address_number').fill(HOUSE_NUMBER);
    await page.locator('#paramount_client_contact_info_address_street').fill(STREET_NAME);
    await page.locator('#paramount_client_contact_info_address_building').fill(BUILDING_NAME);
    await page.locator('#paramount_client_contact_info_address_barangay').fill(BARANGAY);
    await page.locator('#paramount_client_contact_info_address_province').selectOption({ label: 'Cebu' });
    await page.waitForTimeout(2000);
    await page.locator('#paramount_client_contact_info_address_city').selectOption({ index: 1 });
    await page.locator('#paramount_client_contact_info_mobile_number').fill(MOBILE_NUM);
    await page.locator('#paramount_client_contact_info_telephone_number').fill(TELEPHONE_NUM);
    await page.locator('#btn-contact').evaluate((btn: HTMLButtonElement) => btn.click());

    await page.locator('#policy_type').waitFor({ state: 'visible' });
    await page.locator('#policy_type').selectOption({ value: '1' });
    await page.waitForTimeout(2000);
    await page.locator('#mv_type').selectOption({ label: 'Car' });

    // Private Car base premium before the COV fee
    await expect(page.locator('#total_premium')).toContainText('606.00', { timeout: 15000 });
    await page.locator('#total_premium').scrollIntoViewIfNeeded();
    await proofShot(page, testInfo.project.name, 'e2e-1-private-car-base-606');

    // VVIP region dropdown replaced the old has_added_vfee Yes/No radio.
    // Selecting a region triggers an async fee lookup that the Next button waits on.
    const ltoRegion = page.locator('#lto_region');
    if (await ltoRegion.count() > 0) {
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/ctpl-vvip-fees') && resp.status() === 200),
            ltoRegion.selectOption({ index: 1 }),
        ]);
    }

    // 606.00 base + 74.00 COV verification fee = 680.00
    await expect(page.locator('#total_premium')).toContainText('680.00', { timeout: 15000 });
    await page.locator('#total_premium').scrollIntoViewIfNeeded();
    await proofShot(page, testInfo.project.name, 'e2e-2-private-car-with-region-680');

    await expect(page.locator('#btn-policy')).toBeEnabled({ timeout: 15000 });
    await page.locator('#btn-policy').click();

    await page.locator('#c2c_car_info_year_model').waitFor({ state: 'visible' });
    await page.locator('#policy_product_line_id_1').check();
    await page.locator('#c2c_car_info_year_model').selectOption({ value: '2023' });
    await page.locator('#c2c_car_info_c2c_vehicle_maker_id').selectOption({ value: '17' });
    await page.waitForTimeout(2000);
    await page.locator('#c2c_car_info_c2c_vehicle_trim_id').selectOption({ index: 1 });
    await page.locator('#c2c_car_info_color').fill(VEHICLE_COLOR);
    await page.locator('#btn-vehicle').evaluate((btn: HTMLButtonElement) => btn.click());

    await page.locator('#c2c_car_info_mv_file_number2').waitFor({ state: 'visible' });
    await page.locator('#c2c_car_info_mv_file_number2').fill(MV_FILE_NUM_1);
    await page.locator('#c2c_car_info_mv_file_number').fill(MV_FILE_NUM_2);
    await page.locator('#c2c_car_info_motor_number').fill(ENGINE_NUMBER);
    await page.locator('#c2c_car_info_serial_chasis').fill(CHASSIS_NUMBER);
    await page.locator('button#submit-btn', { hasText: 'Review Application' }).evaluate((btn: HTMLButtonElement) => btn.click());

    await expect(page.locator('h4:has-text("Client Information")')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await proofShot(page, testInfo.project.name, 'e2e-3-review-application-premium');
    await page.locator('#dpa_a').scrollIntoViewIfNeeded();
    await page.locator('#dpa_a').check();
    await page.locator('#dpa_b').check();
    await page.locator('#dpa_c').check();
    await page.locator('#dpa_d').check();
    await page.locator('#dpa_e').check();
    // Checking all five individually already auto-checks #dpa_all via the page's own
    // sync handler — clicking "Accept all terms" afterward would toggle it back off
    // and cascade-uncheck a-e again, so it's intentionally not clicked here.

    // Mobile OTP verification now gates submission (previously a direct .btn-confirm click).
    const sendOtpLink = page.locator('#send-otp-link');
    await sendOtpLink.waitFor({ state: 'visible', timeout: 10000 });
    await Promise.all([
        page.waitForResponse(resp => resp.url().includes('send-otp') && resp.status() === 200, { timeout: 15000 }),
        sendOtpLink.click(),
    ]);

    const otpInputs = page.locator('.otp-input');
    await expect(otpInputs.first()).toBeEnabled({ timeout: 30000 });

    const hardcodedOtp = '834793';
    for (let i = 0; i < hardcodedOtp.length; i++) {
        await otpInputs.nth(i).click();
        await otpInputs.nth(i).pressSequentially(hardcodedOtp[i], { delay: 150 });
    }
    await page.locator('body').click();

    const submitBtn = page.locator('#submit-application');
    await expect(submitBtn).toBeEnabled({ timeout: 15000 });
    await submitBtn.click();

    await page.waitForURL('**/payment-instructions/**', { timeout: 30000 });
    paymentUrl = page.url();
    await proofShot(page, testInfo.project.name, 'e2e-4-payment-instructions');

    console.log('\n=========================================');
    console.log(`✅ TEST 1 COMPLETE | APPLICATION SUBMITTED!`);
    console.log(`👤 Name: ${appliedFirstName} ${appliedLastName}`);
    console.log(`🆔 Application ID: ${paymentUrl.split('/').pop()}`);
    console.log('=========================================\n');
  });

  // ====================================================================
  // TEST 2: PAYMENT PROCESS (BDO)
  // ====================================================================
  test('CTPL Website - BDO Payment Process', async ({}, testInfo) => {
    test.skip(!paymentUrl, 'Skipping payment test because the application test did not generate a URL.');

    await page.goto(paymentUrl, { waitUntil: 'domcontentloaded' });
    await proofShot(page, testInfo.project.name, 'e2e-5-payment-page');

    await page.getByRole('checkbox').first().check({ force: true });
    await page.locator('img[src*="online_icon.png"]').click();
    await page.locator('img[alt="BDO Online Bills Payment"]').click();
    await page.locator('#modal_btn_ok').click();

    await page.waitForURL('**/consent**', { timeout: 30000 });
    await page.locator('button#submit-btn', { hasText: 'Continue' }).click();
    await page.locator('button#submit-btn', { hasText: 'Continue' }).click();
    
    // ==========================================
    // FIXED: Dynamic Sandbox Login Handling
    // ==========================================
    const loginBtn = page.locator('#loginBtn');
    await loginBtn.waitFor({ state: 'visible' });

    const passwordInput = page.locator('input[type="password"]');
    
    // Check if the password field is present on the screen
    if (await passwordInput.isVisible()) {
        // Grab the pre-filled email from the username field
        const usernameInput = page.locator('input[type="text"], input[type="email"]').first();
        const email = await usernameInput.inputValue();
        
        // Extract the prefix (e.g., 'user+8' from 'user+8@domain.com')
        const password = email.split('@')[0];
        
        // Fill the extracted password
        await passwordInput.fill(password);
    }

    // Now safely click Login
    await loginBtn.click();
    // ==========================================

    const firstSubmitBtn = page.locator('button#submit-btn', { hasText: 'Submit' });
    await firstSubmitBtn.waitFor({ state: 'visible', timeout: 120000 });
    await firstSubmitBtn.click();

    await page.locator('div')
        .filter({ hasText: 'SAVINGS' })
        .filter({ hasText: '₱' })
        .last() // <-- ADD THIS to target the innermost matching row
        .click();
    await page.locator('#transferSubmitButton').click();
    await page.locator('button#submit-btn', { hasText: 'Submit' }).click();
    await page.locator('button#submit-btn', { hasText: 'Done' }).click();

    await page.waitForTimeout(5000);
    await proofShot(page, testInfo.project.name, 'e2e-6-payment-result');

    console.log('\n=========================================');
    console.log(`✅ TEST 2 COMPLETE | PAYMENT SUCCESSFUL!`);
    console.log(`👤 Name: ${appliedFirstName} ${appliedLastName}`);
    console.log(`🆔 Application ID: ${paymentUrl.split('/').pop()}`);
    console.log('=========================================\n');
  });
});

// ====================================================================
// PREMIUM CHECK PER POLICY TYPE / MV TYPE
// Stops at the policy step (no application is submitted). Reads the base
// premium the site returns, then verifies selecting a region adds the 74 COV fee.
// ====================================================================
const COV_FEE = 74;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PREMIUM_CASES = [
  { name: 'Private Car / Car', policyValue: '1', mvValue: '1' },
  { name: 'Commercial Vehicle / Truck', policyValue: '2', mvValue: '9' },
  { name: 'Commercial Vehicle / Trailer', policyValue: '2', mvValue: '10' },
  { name: 'Commercial Vehicle / Utility Vehicle', policyValue: '2', mvValue: '11' },
  { name: 'Commercial Vehicle / Shuttle Bus', policyValue: '2', mvValue: '2' },
  { name: 'Motorcycle / Motorcycle', policyValue: '3', mvValue: '3' },
  { name: 'Motorcycle / Motorcycle with Side Car', policyValue: '3', mvValue: '4' },
  { name: 'Motorcycle / Tricycle', policyValue: '3', mvValue: '13' },
  { name: 'Motorcycle / Non-Conventional MV', policyValue: '3', mvValue: '14' },
];

test.describe('CTPL Premium Check - Base + 74 COV Fee', () => {
  test.beforeAll(async ({}, testInfo) => {
    fs.writeFileSync(
      proofFile(testInfo.project.name, 'vehicle-type-premium-results', 'csv'),
      '"Browser","Policy / MV Type","Region Selected","Base Premium","COV Fee","Total","Result"\n'
    );
  });

  for (const c of PREMIUM_CASES) {
    test(`Premium: ${c.name}`, async ({ page }, testInfo) => {
      const shotName = `${testInfo.project.name}_${c.name}`.replace(/[^a-zA-Z0-9]+/g, '-');

      await page.goto('https://ctpl-demo.herokuapp.com/apply', { waitUntil: 'domcontentloaded' });
      const reminderModal = page.locator('.modal-content', { has: page.locator('h3.modal-title', { hasText: 'Reminder' }) });
      const closeReminderBtn = reminderModal.getByLabel('Close');
      await closeReminderBtn.waitFor({ state: 'visible', timeout: 15000 });
      await closeReminderBtn.click();

      await page.locator('#paramount_client_contact_info_email_address').fill('qatest0321@gmail.com');
      await page.locator('#paramount_client_first_name').fill(faker.person.firstName());
      await page.locator('#paramount_client_surname').fill(faker.person.lastName());
      await page.locator('#c2c_car_info_plate_number').fill(faker.string.alpha(3).toUpperCase() + faker.string.numeric(4));
      await page.locator('#paramount_client_same_with_owner').selectOption({ label: 'Yes' });
      await page.locator('#btn-personal').click();

      await page.locator('#paramount_client_contact_info_address_number').waitFor({ state: 'visible' });
      await page.locator('#paramount_client_contact_info_address_number').fill(faker.location.buildingNumber());
      await page.locator('#paramount_client_contact_info_address_street').fill(faker.location.street());
      await page.locator('#paramount_client_contact_info_address_barangay').fill('Barangay 1');
      await page.locator('#paramount_client_contact_info_address_province').selectOption({ label: 'Cebu' });
      await page.waitForTimeout(2000);
      await page.locator('#paramount_client_contact_info_address_city').selectOption({ index: 1 });
      await page.locator('#paramount_client_contact_info_mobile_number').fill('9171234567');
      await page.locator('#paramount_client_contact_info_telephone_number').fill(faker.string.numeric(7));
      await page.locator('#btn-contact').evaluate((btn: HTMLButtonElement) => btn.click());

      await page.locator('#policy_type').waitFor({ state: 'visible' });
      await page.locator('#policy_type').selectOption({ value: c.policyValue });
      await page.waitForTimeout(2000);
      await page.locator('#mv_type').selectOption({ value: c.mvValue });

      const totalPremium = page.locator('#total_premium');
      await expect.poll(async () => parseFloat((await totalPremium.getAttribute('data-base-premium')) || '0'), { timeout: 15000 }).toBeGreaterThan(0);
      const base = parseFloat((await totalPremium.getAttribute('data-base-premium')) || '0');

      // No region selected yet: total is just the base premium
      await expect(totalPremium).toContainText(money(base));
      await totalPremium.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: proofPath(`${shotName}_1-base`, 'png') });

      const ltoRegion = page.locator('#lto_region');
      await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/ctpl-vvip-fees') && resp.status() === 200),
        ltoRegion.selectOption({ index: 1 }),
      ]);

      await expect(totalPremium).toContainText(money(base + COV_FEE), { timeout: 15000 });
      await expect(page.locator('#btn-policy')).toBeEnabled({ timeout: 15000 });
      await totalPremium.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: proofPath(`${shotName}_2-with-region`, 'png') });

      const regionLabel = (await ltoRegion.locator('option:checked').textContent())?.trim() ?? '';
      fs.appendFileSync(
        proofFile(testInfo.project.name, 'vehicle-type-premium-results', 'csv'),
        `"${testInfo.project.name}","${c.name}","${regionLabel}",${money(base).replace(/,/g, '')},${COV_FEE},${money(base + COV_FEE).replace(/,/g, '')},PASS\n`
      );

      console.log(`✅ ${c.name}: base ${money(base)} + ${COV_FEE} = ${money(base + COV_FEE)}`);

      const video = page.video();
      await page.close();
      await video?.saveAs(proofPath(shotName, 'webm'));
    });
  }
});

// ====================================================================
// PREMIUM CHECK FOR EVERY REGION (Private Car / Car)
// Selects each region in the dropdown and captures the premium shown.
// Regions with no COV (QB-49 rule): CAR (2), Region I (3), BARMM (18) -> base only.
// All other regions -> base + 74. Soft assertions so every region is captured.
// ====================================================================
const NO_COV_REGION_VALUES = ['2', '3', '18'];

test.describe('CTPL Premium Check - All Regions', () => {
  test('Premium per region: Private Car / Car', async ({ page }, testInfo) => {
    const browserName = testInfo.project.name;

    await page.goto('https://ctpl-demo.herokuapp.com/apply', { waitUntil: 'domcontentloaded' });
    const reminderModal = page.locator('.modal-content', { has: page.locator('h3.modal-title', { hasText: 'Reminder' }) });
    const closeReminderBtn = reminderModal.getByLabel('Close');
    await closeReminderBtn.waitFor({ state: 'visible', timeout: 15000 });
    await closeReminderBtn.click();

    await page.locator('#paramount_client_contact_info_email_address').fill('qatest0321@gmail.com');
    await page.locator('#paramount_client_first_name').fill(faker.person.firstName());
    await page.locator('#paramount_client_surname').fill(faker.person.lastName());
    await page.locator('#c2c_car_info_plate_number').fill(faker.string.alpha(3).toUpperCase() + faker.string.numeric(4));
    await page.locator('#paramount_client_same_with_owner').selectOption({ label: 'Yes' });
    await page.locator('#btn-personal').click();

    await page.locator('#paramount_client_contact_info_address_number').waitFor({ state: 'visible' });
    await page.locator('#paramount_client_contact_info_address_number').fill(faker.location.buildingNumber());
    await page.locator('#paramount_client_contact_info_address_street').fill(faker.location.street());
    await page.locator('#paramount_client_contact_info_address_barangay').fill('Barangay 1');
    await page.locator('#paramount_client_contact_info_address_province').selectOption({ label: 'Cebu' });
    await page.waitForTimeout(2000);
    await page.locator('#paramount_client_contact_info_address_city').selectOption({ index: 1 });
    await page.locator('#paramount_client_contact_info_mobile_number').fill('9171234567');
    await page.locator('#paramount_client_contact_info_telephone_number').fill(faker.string.numeric(7));
    await page.locator('#btn-contact').evaluate((btn: HTMLButtonElement) => btn.click());

    await page.locator('#policy_type').waitFor({ state: 'visible' });
    await page.locator('#policy_type').selectOption({ value: '1' });
    await page.waitForTimeout(2000);
    await page.locator('#mv_type').selectOption({ value: '1' });

    const totalPremium = page.locator('#total_premium');
    await expect(totalPremium).toContainText(money(606), { timeout: 15000 });

    const ltoRegion = page.locator('#lto_region');
    const regions = await ltoRegion.locator('option').evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).filter((o) => o.value !== '').map((o) => ({ value: o.value, label: (o.textContent || '').trim() })));
    expect(regions.length).toBeGreaterThan(0);

    const rows: string[] = ['"Browser","Region","Region value","Expected COV fee","Expected total","Result"'];
    for (const [i, r] of regions.entries()) {
      const fee = NO_COV_REGION_VALUES.includes(r.value) ? 0 : COV_FEE;
      await Promise.all([
        page.waitForResponse((resp) => resp.url().includes('/ctpl-vvip-fees') && resp.status() === 200),
        ltoRegion.selectOption({ value: r.value }),
      ]);
      await page.waitForTimeout(1000);
      await totalPremium.scrollIntoViewIfNeeded();

      const shown = ((await totalPremium.textContent()) || '').replace(/\s+/g, ' ').trim();
      const ok = shown.includes(money(606 + fee));
      await expect.soft(totalPremium, `${r.label}: expected ${money(606 + fee)}, shown ${shown}`).toContainText(money(606 + fee), { timeout: 5000 });
      await proofShot(page, browserName, `region-${String(i + 1).padStart(2, '0')}-${r.label}`);
      rows.push(`"${browserName}","${r.label}",${r.value},${fee},${money(606 + fee).replace(/,/g, '')},"${ok ? 'PASS' : 'FAIL (shown ' + shown + ')'}"`);
      console.log(`${ok ? '✅' : '❌'} ${r.label}: expected ${money(606 + fee)} | shown ${shown}`);
    }
    fs.writeFileSync(proofFile(browserName, 'regions-results', 'csv'), rows.join('\n') + '\n');

    const video = page.video();
    await page.close();
    await video?.saveAs(proofFile(browserName, 'regions-video', 'webm'));
  });
});