# QB-49 | RD-184 - Set 2 Motorcycle

- **Date of testing:** 2026-10-01
- **Environment:** https://ctpl-demo.herokuapp.com
- **Browser:** Microsoft Edge
- **Test Status:** FAILED (5 passed, 1 failed; 6 total)

| # | Scenario | Test Status | Expected Output | System Output | Test Remarks |
|---|---|---|---|---|---|
| 1 | QB-49 E \| Set 2 Motorcycle \| COV region (NCR) > CTPL Website - Application Process | PASSED | Application for Set 2 Motorcycle in COV region (NCR) completes: no VVIP opt-in prompt, DPA accepted, OTP verified, redirected to payment instructions. | Set 2 Motorcycle \| policy=3 mv=3 \| Total Premium shown: 370.00 \| expected: 370.00 / ✅ TEST 1 COMPLETE \| APPLICATION SUBMITTED! | As expected. |
| 2 | QB-49 E \| Set 2 Motorcycle \| COV region (NCR) > CTPL Website - BDO Payment Process | PASSED | Payment instructions page proceeds through BDO sandbox payment to a successful payment (screenshot attached). | Reached BDO sandbox success; final URL https://ctpl-demo.herokuapp.com/pay-online/result?requestid=MjYwMDA2ODYzMTE3OTA4MzQ4OTkxMA== \| ✅ TEST 2 COMPLETE \| PAYMENT SUCCESSFUL! | As expected. |
| 3 | QB-49 E \| Set 2 Motorcycle \| COV region (NCR) > Total Premium matches expected (base + COV fee) | PASSED | Total Premium = one-year base (rate table) + P74 verification fee for COV regions; base only for non-COV regions. | Total Premium shown P370.00 (expected P370.00) | As expected. |
| 4 | QB-49 E \| Set 2 Motorcycle \| No-COV region (CAR) > CTPL Website - Application Process | PASSED | Application for Set 2 Motorcycle in No-COV region (CAR) completes: no VVIP opt-in prompt, DPA accepted, OTP verified, redirected to payment instructions. | Set 2 Motorcycle \| policy=3 mv=3 \| Total Premium shown: 370.00 \| expected: 296.00 / ✅ TEST 1 COMPLETE \| APPLICATION SUBMITTED! | As expected. |
| 5 | QB-49 E \| Set 2 Motorcycle \| No-COV region (CAR) > CTPL Website - BDO Payment Process | PASSED | Payment instructions page proceeds through BDO sandbox payment to a successful payment (screenshot attached). | Reached BDO sandbox success; final URL https://ctpl-demo.herokuapp.com/pay-online/result?requestid=MjYwMDA2ODYzMjE3OTA4MzUwNzMxMA== \| ✅ TEST 2 COMPLETE \| PAYMENT SUCCESSFUL! | As expected. |
| 6 | QB-49 E \| Set 2 Motorcycle \| No-COV region (CAR) > Total Premium matches expected (base + COV fee) | FAILED | Total Premium = one-year base (rate table) + P74 verification fee for COV regions; base only for non-COV regions. | Total Premium shown P370.00 (expected P296.00) \| Error: expect(received).toBe(expected) // Object.is equality \| Expected: 296 \| Received: 370 | FAILED vs QB-49 rule: CAR is not in the COV list, so only the base premium (296.00) should show. System shows base + P74 (370.00). Fee comes from the region config (vvip_agent_regions); CAR is enrolled with P74 in this environment. |
