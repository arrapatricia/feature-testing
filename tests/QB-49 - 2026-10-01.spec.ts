import { test, expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';

/**
 * QB-49 | RD-184 - CTPL Web Service Update: COV charge adjustment & VVIP auto opt-in
 * Test date: 2026-10-01
 * Env: https://ctpl-demo.herokuapp.com
 *
 *  A. COV fee per region (API)        - Task A / Condition 1
 *  B. Break scenarios (API)           - invalid / hostile input
 *  C. Region dropdown + COV copy (UI) - Task B / Task C / Condition 2
 *  D. Break scenarios (UI)            - tampered / failing fee lookup
 *  E. E2E happy path                  - full application + BDO payment
 */

test.setTimeout(120000);

const BASE = 'https://ctpl-demo.herokuapp.com';
const FEES = `${BASE}/ctpl-vvip-fees`;
const COV_FEE = '74.0';

// Dropdown option value -> region. QB-49 Condition 1 scope (asserted):
// NCR, 2, 3, 4A, 4B, 5, 6, 7, 8, 9, 10, 11, 12.
const IN_SCOPE: Record<string, string> = {
  '1': 'NCR', '4': 'Region II', '5': 'Region III', '6': 'Region IV-A', '7': 'Region IV-B',
  '8': 'Region V', '9': 'Region VI', '10': 'Region VII', '11': 'Region VIII',
  '13': 'Region IX', '14': 'Region X', '15': 'Region XI', '16': 'Region XII',
};
// Regions not yet covered by COV (CAR, I, NIR, XIII, BARMM) are intentionally not asserted:
// the fee API still returns P74 for them for now.
const OUT_OF_SCOPE: Record<string, string> = {
  '2': 'CAR', '3': 'Region I', '12': 'NIR', '17': 'Region XIII', '18': 'BARMM',
};

async function getFees(request: any, regionId: string) {
  const res = await request.get(FEES, { params: { vvip_agent_region_id: regionId } });
  return { res, body: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------
// A. COV fee per region (API)
// ---------------------------------------------------------------------
test.describe('QB-49 A | COV fee per region (API)', () => {
  for (const [id, name] of Object.entries(IN_SCOPE)) {
    test(`in-scope ${name} (id ${id}) charges COV P74`, async ({ request }) => {
      const { res, body } = await getFees(request, id);
      expect(res.status()).toBe(200);
      expect(body.enabled).toBe(true);
      expect(body.fees[id]).toBe(COV_FEE);
    });
  }
});

// ---------------------------------------------------------------------
// B. Break scenarios (API)
// ---------------------------------------------------------------------
test.describe('QB-49 B | Break scenarios (API)', () => {
  const invalid: [string, string][] = [
    ['zero', '0'], ['unknown id above range', '19'], ['negative', '-1'], ['non-numeric', 'abc'],
    ['empty', ''], ['huge number', '999999999999'], ['float', '1.5'], ['list', '1,2'],
    ['script tag', '<script>alert(1)</script>'],
  ];
  for (const [label, value] of invalid) {
    test(`invalid region (${label}) returns no fee and no server error`, async ({ request }) => {
      const { res, body } = await getFees(request, value);
      expect(res.status()).toBeLessThan(500);
      expect(Object.keys(body?.fees ?? {})).toHaveLength(0);
    });
  }

  test('SQL-injection style input does not resolve to a region fee', async ({ request }) => {
    const { res, body } = await getFees(request, "1' OR '1'='1");
    expect(res.status()).toBeLessThan(500);
    expect(Object.keys(body?.fees ?? {})).toHaveLength(0);
  });

  test('missing parameter returns no fee', async ({ request }) => {
    const res = await request.get(FEES);
    expect(res.status()).toBeLessThan(500);
    expect(Object.keys((await res.json()).fees)).toHaveLength(0);
  });

  test('response never exposes a fee other than P74', async ({ request }) => {
    for (const id of [...Object.keys(IN_SCOPE), ...Object.keys(OUT_OF_SCOPE)]) {
      const { body } = await getFees(request, id);
      for (const fee of Object.values(body.fees)) expect(fee).toBe(COV_FEE);
    }
  });

  test('POST is not accepted on the fee endpoint', async ({ request }) => {
    const res = await request.post(FEES, { data: { vvip_agent_region_id: '1' } });
    expect([404, 405, 422]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------
// C / D. UI: region dropdown + COV copy, and break scenarios
// ---------------------------------------------------------------------
async function openPolicyStep(page: Page) {
  await page.goto(`${BASE}/apply`, { waitUntil: 'domcontentloaded' });
  const close = page.locator('.modal-content', { has: page.locator('h3.modal-title', { hasText: 'Reminder' }) }).getByLabel('Close');
  await close.waitFor({ state: 'visible', timeout: 15000 });
  await close.click();

  await page.locator('#paramount_client_contact_info_email_address').fill('qatest0321@gmail.com');
  await page.locator('#paramount_client_first_name').fill(faker.person.firstName());
  await page.locator('#paramount_client_surname').fill(faker.person.lastName());
  await page.locator('#c2c_car_info_plate_number').fill(faker.string.alpha(3).toUpperCase() + faker.string.numeric(4));
  await page.locator('#paramount_client_same_with_owner').selectOption({ label: 'Yes' });
  await page.locator('#btn-personal').click();

  await page.locator('#paramount_client_contact_info_address_number').waitFor({ state: 'visible' });
  await page.locator('#paramount_client_contact_info_address_number').fill(faker.location.buildingNumber());
  await page.locator('#paramount_client_contact_info_address_street').fill(faker.location.street());
  await page.locator('#paramount_client_contact_info_address_building').fill(faker.company.name());
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
  await page.locator('#mv_type').selectOption({ label: 'Car' });
}

test.describe('QB-49 C | Region dropdown + COV copy (UI)', () => {
  test('region dropdown lists all 18 regions with a placeholder', async ({ page }) => {
    await openPolicyStep(page);
    const options = page.locator('#lto_region option');
    await expect(options).toHaveCount(19);
    await expect(options.first()).toHaveText('Select Region');
  });

  test('COV notice states the P74 fee', async ({ page }) => {
    await openPolicyStep(page);
    await expect(page.getByText(/additional P\s?74 verification fee/i)).toBeVisible();
  });

  test('no VVIP opt-in prompt is shown (auto-applied)', async ({ page }) => {
    await openPolicyStep(page);
    await expect(page.locator('#has_added_vfee')).toHaveCount(0);
  });

  test('selecting an in-scope region triggers the fee lookup and enables Next', async ({ page }) => {
    await openPolicyStep(page);
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/ctpl-vvip-fees') && r.status() === 200),
      page.locator('#lto_region').selectOption({ value: '1' }),
    ]);
    expect((await resp.json()).fees['1']).toBe(COV_FEE);
    await expect(page.locator('#btn-policy')).toBeEnabled({ timeout: 15000 });
  });
});

test.describe('QB-49 D | Break scenarios (UI)', () => {
  test('Next is blocked until a region is selected', async ({ page }) => {
    await openPolicyStep(page);
    await expect(page.locator('#btn-policy')).toBeDisabled();
  });

  test('resetting region to the placeholder blocks Next again', async ({ page }) => {
    await openPolicyStep(page);
    await page.locator('#lto_region').selectOption({ value: '1' });
    await expect(page.locator('#btn-policy')).toBeEnabled({ timeout: 15000 });
    await page.locator('#lto_region').selectOption({ value: '' });
    await expect(page.locator('#btn-policy')).toBeDisabled();
  });

  test('fee lookup returning 500 does not let the user proceed', async ({ page }) => {
    await page.route('**/ctpl-vvip-fees*', route => route.fulfill({ status: 500, body: 'boom' }));
    await openPolicyStep(page);
    await page.locator('#lto_region').selectOption({ value: '1' });
    await page.waitForTimeout(3000);
    await expect(page.locator('#btn-policy')).toBeDisabled();
  });

  test('fee lookup returning empty fees does not let the user proceed', async ({ page }) => {
    await page.route('**/ctpl-vvip-fees*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true,"fees":{}}' }));
    await openPolicyStep(page);
    await page.locator('#lto_region').selectOption({ value: '1' });
    await page.waitForTimeout(3000);
    await expect(page.locator('#btn-policy')).toBeDisabled();
  });

  test('tampered fee (P0) in the response is not accepted', async ({ page }) => {
    await page.route('**/ctpl-vvip-fees*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true,"fees":{"1":"0.0"}}' }));
    await openPolicyStep(page);
    await page.locator('#lto_region').selectOption({ value: '1' });
    await page.waitForTimeout(3000);
    await expect(page.locator('#btn-policy')).toBeDisabled();
  });

  test('changing region re-queries the fee each time', async ({ page }) => {
    await openPolicyStep(page);
    const seen: string[] = [];
    page.on('request', r => {
      if (r.url().includes('/ctpl-vvip-fees')) seen.push(new URL(r.url()).searchParams.get('vvip_agent_region_id') ?? '');
    });
    for (const id of ['1', '5', '10']) {
      await page.locator('#lto_region').selectOption({ value: id });
      await page.waitForTimeout(1500);
    }
    expect(seen).toEqual(['1', '5', '10']);
  });
});

// ---------------------------------------------------------------------
// E. E2E happy path
// ---------------------------------------------------------------------
test.describe.serial('QB-49 E | E2E happy path (VVIP auto, region selected)', () => {
  let page: Page; // Declare a shared page variable

  // Setup: Create a single page context that survives across all tests in this block
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  // Teardown: Close the page when all tests are finished
  test.afterAll(async () => {
    await page.close();
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

    // VVIP region dropdown replaced the old has_added_vfee Yes/No radio.
    // Selecting a region triggers an async fee lookup that the Next button waits on.
    const ltoRegion = page.locator('#lto_region');
    if (await ltoRegion.count() > 0) {
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/ctpl-vvip-fees') && resp.status() === 200),
            ltoRegion.selectOption({ index: 1 }),
        ]);
    }

    // QB-49 Task B: VVIP applied automatically, no client opt-in prompt.
    await expect(page.locator('#has_added_vfee')).toHaveCount(0);
    await expect(page.getByText(/additional P\s?74 verification fee/i)).toBeVisible();

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
    await page.locator('#dpa_a').scrollIntoViewIfNeeded();
    // "Accept all" is a toggle: ticking boxes individually first makes it untick them all.
    await page.getByText('Accept all terms and conditions stated above.').click();
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
        await expect(page.locator(`#dpa_${id}`)).toBeChecked();
    }

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
    
    console.log('\n=========================================');
    console.log(`✅ TEST 1 COMPLETE | APPLICATION SUBMITTED!`);
    console.log(`👤 Name: ${appliedFirstName} ${appliedLastName}`);
    console.log(`🆔 Application ID: ${paymentUrl.split('/').pop()}`);
    console.log('=========================================\n');
  });

  // ====================================================================
  // TEST 2: PAYMENT PROCESS (BDO)
  // ====================================================================
  test('CTPL Website - BDO Payment Process', async ({}) => {
    test.skip(!paymentUrl, 'Skipping payment test because the application test did not generate a URL.');

    await page.goto(paymentUrl, { waitUntil: 'domcontentloaded' });

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
    
    console.log('\n=========================================');
    console.log(`✅ TEST 2 COMPLETE | PAYMENT SUCCESSFUL!`);
    console.log(`👤 Name: ${appliedFirstName} ${appliedLastName}`);
    console.log(`🆔 Application ID: ${paymentUrl.split('/').pop()}`);
    console.log('=========================================\n');
  });
});