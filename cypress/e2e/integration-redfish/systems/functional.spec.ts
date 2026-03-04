/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Redfish Computer System — Functional Tests
 *
 * Exercises end-to-end functional correctness of Computer System actions via
 * the Redfish API, verifying that actions produce real-world state changes on
 * a live AMT device.
 *
 * Every API call is logged in real-time to:
 *   • The Cypress runner (cy.log)
 *   • The terminal stdout (via cy.task)
 *   • A timestamped file under cypress/logs/  (via cy.task)
 *
 * Prerequisites:
 *   • REDFISH_SYSTEM_ID env var must point to a reachable, powered-ON device.
 *   • Console backend running on REDFISH_BASEURL (default: https://localhost:8181).
 *
 * Run with:
 *   npx cypress run --config-file cypress.redfish.config.ts
 *   npm run cy-runner:redfish
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import { systemsFixtures } from 'cypress/e2e/fixtures/api/redfish/systems'

const redfishUrl = (): string => Cypress.env('REDFISH_BASEURL') ?? 'http://localhost:8181'

const basicAuthHeaders = (): Record<string, string> => {
  const username = (Cypress.env('REDFISH_USERNAME') as string) ?? 'standalone'
  const password = (Cypress.env('REDFISH_PASSWORD') as string) ?? 'G@ppm0ym'
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` }
}

const systemId = (): string =>
  (Cypress.env('REDFISH_SYSTEM_ID') as string) ?? systemsFixtures.testSystemId

/**
 * Wrapper around cy.request() that logs each API call and its response to:
 *   • cy.log()         — shown in the Cypress runner / interactive UI
 *   • cy.task('log')   — written to stdout AND the timestamped log file
 *
 * @param label  Short label shown in log lines, e.g. "Step 2 ForceOff"
 * @param options Standard cy.request options (failOnStatusCode defaults to false)
 */
const loggedRequest = (
  label: string,
  options: Partial<Cypress.RequestOptions> & { url: string }
): Cypress.Chainable<Cypress.Response<unknown>> => {
  const method = (options.method ?? 'GET') as string
  const bodyStr = options.body != null ? `  body: ${JSON.stringify(options.body)}` : ''
  const reqLine = `  [${label}] → ${method} ${options.url}${bodyStr}`
  cy.task('log', reqLine)
  cy.log(`→ **${method}** \`${options.url}\``)
  return cy
    .request({ failOnStatusCode: false, ...options } as Cypress.RequestOptions)
    .then((res) => {
      const preview = JSON.stringify(res.body).slice(0, 600)
      cy.task('log', `  [${label}] ← ${res.status}  ${preview}`)
      cy.log(`← **${res.status}**`)
      return cy.wrap(res)
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Power Cycle Lifecycle — Full Power OFF → ON flow with recursive state polling
//
// Flow:
//   Pre-flight: Poll until PowerState = "On" (max 2 min) — handles re-runs
//               where the device is still booting from a previous cycle.
//   1. GET  system  → assert PowerState is "On"
//   2. POST ForceOff → assert 202 Accepted
//   3. Poll GET every 10 s, up to 60 s,   until PowerState = "Off"
//          (ForceOff is a hard power cut — device loses power within seconds)
//   4. Fixed 10-second settle wait
//   5. POST On      → assert 202 Accepted
//   6. Fixed 3-minute boot wait
//   7. Poll GET every 10 s, up to 3 min,  until PowerState = "On"
//
// Worst-case: 2 min pre-flight + ~7 min 10 s → test timeout set to 12 min.
// Skips gracefully when device is unreachable (404/500).
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Power Action Functional Test', () => {
  context('ForceOff then On transitions device through Off state and back to On', () => {
    /** Interval between each poll GET */
    const POLL_INTERVAL_MS = 10_000
    /**
     * Max wait for PowerState to reach "Off" after a ForceOff (hard power cut).
     * ForceOff is instantaneous at the hardware level — 60 s is generous.
     */
    const POWER_OFF_TIMEOUT_MS = 60_000
    /**
     * Max wait for PowerState to reach "On" after booting, and for the
     * pre-flight poll. Boot involves full OS startup, so 3 min is appropriate.
     */
    const POWER_ON_TIMEOUT_MS = 3 * 60 * 1000

    /**
     * Recursively polls GET /redfish/v1/Systems/{id} until PowerState equals
     * targetState. Logs every poll result to terminal and log file.
     * Throws (fails the test) if deadline is exceeded.
     */
    const pollPowerState = (
      targetState: string,
      deadline: number = Date.now() + POWER_ON_TIMEOUT_MS
    ): void => {
      loggedRequest(`POLL→"${targetState}"`, {
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
        headers: basicAuthHeaders()
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        const current = (response.body as Record<string, string>).PowerState
        cy.task('log', `    PowerState: "${current}" (target: "${targetState}")`)
        if (current === targetState) {
          cy.task('log', `    ✅ PowerState reached: "${targetState}"`)
          return
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for PowerState="${targetState}". Last observed: "${current}"`
          )
        }
        cy.wait(POLL_INTERVAL_MS)
        pollPowerState(targetState, deadline)
      })
    }

    it('powers OFF then ON and verifies state transitions', function () {
      this.timeout(12 * 60 * 1000)
      cy.task('log', '\n════════════════════════════════════════════════════════')
      cy.task('log', ' TEST: Redfish System Power Action Functional Test')
      cy.task('log', '════════════════════════════════════════════════════════')

      // ── Pre-flight: ensure device is reachable and PowerState = "On" ────────
      // Handles consecutive runs where the device may still be booting.
      cy.task('log', '\n── Pre-flight: check device reachability & PowerState ──')
      loggedRequest('Pre-flight GET', {
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
        headers: basicAuthHeaders()
      }).then((preflight) => {
        if (preflight.status !== httpCodes.SUCCESS) {
          cy.task('log', `  ⚠️  Device unavailable (HTTP ${preflight.status}) — skipping test`)
          cy.log(`⚠️  Device unavailable — skipping`)
          this.skip()
          return
        }

        const preState = (preflight.body as Record<string, string>).PowerState
        cy.task('log', `  Current PowerState: "${preState}"`)

        if (preState !== 'On') {
          cy.task('log', `  Not "On" yet — polling up to 2 min before starting …`)
          pollPowerState('On', Date.now() + POWER_ON_TIMEOUT_MS)
        }

        // ── Step 1: Confirm PowerState is "On" ──────────────────────────────
        cy.task('log', '\n── Step 1: Confirm PowerState is "On" ──────────────────')
        loggedRequest('Step 1 GET', {
          method: 'GET',
          url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
          headers: basicAuthHeaders()
        }).then((step1) => {
          expect(step1.body, 'Step 1: PowerState must be "On"').to.have.property('PowerState', 'On')
          cy.task('log', '  ✅ PowerState confirmed: "On"')

          // ── Step 2: POST ForceOff ──────────────────────────────────────────
          cy.task('log', '\n── Step 2: POST ForceOff ────────────────────────────────')
          loggedRequest('Step 2 ForceOff', {
            method: 'POST',
            url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
            headers: basicAuthHeaders(),
            body: systemsFixtures.reset.forceOff
          }).then((step2) => {
            expect(step2.status, 'Step 2: ForceOff must return 202').to.eq(202)
            cy.task('log', '  ✅ ForceOff accepted (202)')

            // ── Step 3: Poll until PowerState = "Off" (max 60 s) ───────────
            // ForceOff is a hard power cut — the device loses power within seconds.
            cy.task('log', '\n── Step 3: Poll for PowerState="Off" (max 60 s) ─────────')
            pollPowerState('Off', Date.now() + POWER_OFF_TIMEOUT_MS)

            // ── Step 4: 10-second settle wait ─────────────────────────────
            cy.task('log', '\n── Step 4: 10-second settle wait ────────────────────────')
            cy.wait(10_000)
            cy.task('log', '  ✅ Settle wait complete')

            // ── Step 5: POST On ────────────────────────────────────────────
            cy.task('log', '\n── Step 5: POST On ──────────────────────────────────────')
            loggedRequest('Step 5 On', {
              method: 'POST',
              url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
              headers: basicAuthHeaders(),
              body: systemsFixtures.reset.on
            }).then((step5) => {
              expect(step5.status, 'Step 5: Power On must return 202').to.eq(202)
              cy.task('log', '  ✅ Power On accepted (202)')

              // ── Step 6: Fixed 3-minute boot wait ────────────────────────
              cy.task('log', '\n── Step 6: Fixed 3-minute boot wait ─────────────────────')
              cy.wait(3 * 60 * 1000)
              cy.task('log', '  ✅ Boot wait complete')

              // ── Step 7: Poll until PowerState = "On" (max 3 min) ────────
              cy.task('log', '\n── Step 7: Poll for PowerState="On" (max 3 min) ────────')
              pollPowerState('On')

              cy.task('log', '\n════════════════════════════════════════════════════════')
              cy.task('log', ' ✅ TEST PASSED: Power cycle complete')
              cy.task('log', '════════════════════════════════════════════════════════')
            })
          })
        })
      })
    })
  })
})
