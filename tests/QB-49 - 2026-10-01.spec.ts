import { test, expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';

test.setTimeout(120000); 

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
    await page.locator('#dpa_a').check();
    await page.locator('#dpa_b').check();
    await page.locator('#dpa_c').check();
    await page.locator('#dpa_d').check();
    await page.locator('#dpa_e').check();

    const acceptAllTermsBtn = page.getByText('Accept all terms and conditions stated above.');
    if (await acceptAllTermsBtn.isVisible()) {
        await acceptAllTermsBtn.click();
    }

    const confirmBtn = page.locator('.btn-confirm');
    await confirmBtn.evaluate((node: HTMLButtonElement) => {
        node.classList.remove('disabled');
        node.click(); 
    });

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

    await page.getByRole('checkbox').first().check();
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