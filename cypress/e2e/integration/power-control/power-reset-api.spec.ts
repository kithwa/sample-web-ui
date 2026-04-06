/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Isolated run: TC_POWER_ACTION_RESET via MPS REST API only.
 *
 * No browser / Web UI interaction — all steps use cy.request() against the
 * MPS API directly.
 *
 * Flow:
 *   1.  Authenticate → POST /api/v1/authorize → JWT
 *   2.  Resolve device GUID (env var or auto-fetch first registered device)
 *   2a. Precondition: GET /api/v1/amt/power/state → assert On (2)
 *   3.  Ping pre-check: verify device IP is reachable before issuing the command
 *   4.  Send Reset → POST /api/v1/amt/power/action  { action: 10 }
 *       Assert HTTP 200 and ReturnValue=0
 *   5.  Disconnect check: poll ping immediately after command; require ≥7 s of
 *       continuous ICMP failure within a 30 s window — confirms AMT cut the
 *       main power rail (hard reset).
 *   6.  Reconnect wait: poll ping every 2 s until success, max 3 minutes.
 *   7.  GET /api/v1/amt/power/state → assert On (2) — device fully back online.
 *   8.  Post-test cleanup: ensureDevicePoweredOn to guard against edge cases.
 *
 * Why ping-based disconnect check instead of AMT state polling?
 * ─────────────────────────────────────────────────────────────
 *   Reset (OOB action 10) is hardware-immediate: AMT cuts and restores the
 *   main power rail within ~1–3 s.  During this window the CIRA tunnel to MPS
 *   drops, so any cy.request() against the state endpoint may throw a hard
 *   uncatchable network error inside Cypress.  Using cy.task('ping') keeps the
 *   check entirely in Node.js and always returns a structured result — no
 *   uncaught exceptions, no test abort.
 *
 * Environment variables:
 *   MPS_BASEURL      MPS API base URL (default: https://localhost:8181)
 *   MPS_AUTH_BASEURL Auth URL override for Cloud/Kong deployments
 *                    (default: same as MPS_BASEURL)
 *   MPS_USERNAME     MPS username
 *   MPS_PASSWORD     MPS password
 *   DEVICE_GUID      Target AMT device GUID (auto-fetched if not set)
 *   DEVICE_IP        IP address of the device under test (required for ping check)
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import {
  PowerActions,
  PowerStateValues,
  PowerStateLabels
} from 'cypress/e2e/fixtures/api/power'
import {
  PingResult,
  waitForPingDisconnect,
  waitForPingReconnect
} from 'cypress/e2e/fixtures/api/pingUtils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mpsBaseUrl = (): string =>
  Cypress.env('MPS_BASEURL') as string

const mpsAuthBaseUrl = (): string =>
  (Cypress.env('MPS_AUTH_BASEURL') as string | undefined) ?? mpsBaseUrl()

let token = ''
let resolvedDeviceGuid = ''
const deviceGuid = (): string => resolvedDeviceGuid
const deviceIp = (): string => ((Cypress.env('DEVICE_IP') as string) ?? '').trim()
const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${token}` })

// ─── ensureDevicePoweredOn ────────────────────────────────────────────────────

const ensureDevicePoweredOn = (
  phaseLabel: string,
  successMessage: string,
  checkTimeoutMs = 15000,
  waitAfterPowerUpMs = 30000
): void => {
  if (!token || !resolvedDeviceGuid) return

  cy.task('log', `  ${phaseLabel}: checking device power state …`)
  cy.request({
    method: 'GET',
    url: `${mpsBaseUrl()}/api/v1/amt/power/state/${resolvedDeviceGuid}`,
    headers: authHeaders(),
    failOnStatusCode: false,
    timeout: checkTimeoutMs
  }).then((stateRes) => {
    const state = (stateRes.body as Record<string, number>).powerstate
    const label = PowerStateLabels[state] ?? `unknown(${state})`

    const statusLogChain = stateRes.status !== httpCodes.SUCCESS
      ? cy.task('log', `  ❌ Assertion failed: ${phaseLabel}: GET power/state must return HTTP 200 — got ${stateRes.status}`)
      : cy.wrap(null, { log: false })

    return statusLogChain
      .then(() => { expect(stateRes.status, `${phaseLabel}: GET power/state must return HTTP 200`).to.eq(httpCodes.SUCCESS) })
      .then(() => {
        cy.task('log', `  ${phaseLabel}: powerstate = ${state} (${label})`)

        if (state === PowerStateValues.On) {
          cy.task('log', `  ✅ ${successMessage}`)
          return
        }

        cy.task('log', `  ${phaseLabel}: state is not On — sending Power Up (action ${PowerActions.PowerUp}) …`)
        cy.request({
          method: 'POST',
          url: `${mpsBaseUrl()}/api/v1/amt/power/action/${resolvedDeviceGuid}`,
          headers: authHeaders(),
          body: { action: PowerActions.PowerUp },
          failOnStatusCode: false,
          timeout: checkTimeoutMs
        }).then((wakeRes) => {
          const wakeLogChain = wakeRes.status !== httpCodes.SUCCESS
            ? cy.task('log', `  ❌ Assertion failed: ${phaseLabel}: Power Up must return HTTP 200 — got ${wakeRes.status}`)
            : cy.wrap(null, { log: false })

          return wakeLogChain
            .then(() => { expect(wakeRes.status, `${phaseLabel}: Power Up must return HTTP 200`).to.eq(httpCodes.SUCCESS) })
            .then(() => {
              cy.task('log', `  ${phaseLabel}: Power Up sent; waiting ${waitAfterPowerUpMs / 1000}s for boot …`)
              cy.wait(waitAfterPowerUpMs)
              cy.request({
                method: 'GET',
                url: `${mpsBaseUrl()}/api/v1/amt/power/state/${resolvedDeviceGuid}`,
                headers: authHeaders(),
                failOnStatusCode: false,
                timeout: checkTimeoutMs
              }).then((reCheckRes) => {
                const newState = (reCheckRes.body as Record<string, number>).powerstate
                const newLabel = PowerStateLabels[newState] ?? `unknown(${newState})`

                const reCheckStatusLogChain = reCheckRes.status !== httpCodes.SUCCESS
                  ? cy.task('log', `  ❌ Assertion failed: ${phaseLabel}: re-check GET power/state must return HTTP 200 — got ${reCheckRes.status}`)
                  : cy.wrap(null, { log: false })

                return reCheckStatusLogChain
                  .then(() => { expect(reCheckRes.status, `${phaseLabel}: re-check GET power/state must return HTTP 200`).to.eq(httpCodes.SUCCESS) })
                  .then(() => cy.task('log', `  ${phaseLabel}: re-check powerstate = ${newState} (${newLabel})`))
                  .then(() => {
                    if (newState !== PowerStateValues.On) {
                      return cy.task('log', `  ❌ Assertion failed: ${phaseLabel}: device must be On (${PowerStateValues.On}) after Power Up — got ${newState} (${newLabel})`)
                    }
                    return cy.wrap(undefined, { log: false })
                  })
                  .then(() => {
                    expect(
                      newState,
                      `${phaseLabel}: device must be On (${PowerStateValues.On}) after Power Up — got ${newState} (${newLabel})`
                    ).to.eq(PowerStateValues.On)
                  })
                  .then(() => cy.task('log', `  ✅ ${successMessage}`))
              })
            })
        })
      })
  })
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TC_POWER_ACTION_RESET - Reset via MPS API (isolated run)', () => {
  // ── before: authenticate + resolve GUID ────────────────────────────────────
  before(function () {
    cy.task('log', '\n════════════════════════════════════════════════════════')
    cy.task('log', ' TC_POWER_ACTION_RESET — API isolated run')
    cy.task('log', `  MPS base:      ${mpsBaseUrl()}`)
    cy.task('log', `  MPS auth base: ${mpsAuthBaseUrl()}`)
    cy.task('log', `  Device IP:     ${deviceIp() || '(not set — DEVICE_IP env var required)'}`)
    cy.task('log', '════════════════════════════════════════════════════════')

    cy.request({
      method: 'POST',
      url: `${mpsAuthBaseUrl()}/api/v1/authorize`,
      body: {
        username: (Cypress.env('MPS_USERNAME') as string) ?? 'standalone',
        password: (Cypress.env('MPS_PASSWORD') as string) ?? 'G@ppm0ym'
      },
      failOnStatusCode: false,
      timeout: 15000
    }).then((authRes) => {
      const authLogChain = authRes.status !== httpCodes.SUCCESS
        ? cy.task('log', `  API auth → HTTP ${authRes.status}`)
            .then(() => cy.task('log', `  ❌ Assertion failed: MPS /api/v1/authorize must return 200 — got ${authRes.status}`))
        : cy.task('log', `  API auth → HTTP ${authRes.status}`)

      return authLogChain
        .then(() => { expect(authRes.status, 'MPS /api/v1/authorize must return 200').to.eq(httpCodes.SUCCESS) })
        .then(() => {
          token = (authRes.body as Record<string, string>).token
          cy.task('log', '  ✅ JWT token obtained')

          const configuredGuid = ((Cypress.env('DEVICE_GUID') as string) ?? '').trim()
          if (configuredGuid) {
            resolvedDeviceGuid = configuredGuid
            cy.task('log', `  ✅ Using DEVICE_GUID: ${resolvedDeviceGuid}`)
            return
          }
          cy.task('log', '  DEVICE_GUID not set — auto-fetching first device …')
          cy.request({
            method: 'GET',
            url: `${mpsBaseUrl()}/api/v1/devices?$top=1&$skip=0&$count=true`,
            headers: authHeaders(),
            failOnStatusCode: false,
            timeout: 15000
          }).then((devRes) => {
            if (devRes.status !== httpCodes.SUCCESS) {
              cy.task('log', `  ⚠️  GET /api/v1/devices → HTTP ${devRes.status} — skipping`)
              this.skip()
              return
            }
            const body = devRes.body as { data?: { guid: string }[] }
            if (!body.data?.length) {
              cy.task('log', '  ⚠️  No registered devices — skipping')
              this.skip()
              return
            }
            resolvedDeviceGuid = body.data[0].guid
            cy.task('log', `  ✅ Auto-detected GUID: ${resolvedDeviceGuid}`)
          })
        })
    }).then(() => {
      ensureDevicePoweredOn('Precondition', 'Precondition passed: device is On')
    })
  })

  // ── afterEach: ensure device is back On ────────────────────────────────────
  afterEach(function () {
    if (!token || !resolvedDeviceGuid) return

    cy.task('log', '\n── Post-test cleanup: ensuring device is On ──')
    // Reset self-recovers (device boots back automatically), but guard against
    // edge cases where it may have stayed off.
    ensureDevicePoweredOn('Cleanup', 'Cleanup complete: device is On', 60000, 30000)
    cy.wait(5000)
  })

  // ── TC_POWER_ACTION_RESET ──────────────────────────────────────────────────
  it(
    'TC_POWER_ACTION_RESET: POST power/action(10) → ping confirms disconnect ≥7s → ping reconnects within 3min → assert powerstate=On',
    function () {
      this.timeout(10 * 60 * 1000)

      if (!resolvedDeviceGuid) { this.skip(); return }

      const ip = deviceIp()
      if (!ip) {
        throw new Error(
          'DEVICE_IP env var is not set. ' +
          'Supply the IP address of the device under test:\n' +
          '  --env DEVICE_IP=<ip>   (CLI flag)\n' +
          '  DEVICE_IP=<ip>         (OS environment variable)'
        )
      }

      cy.task('log', '\n── TC_POWER_ACTION_RESET (API + ping) ──')
      cy.task('log', `  Device GUID:  ${deviceGuid()}`)
      cy.task('log', `  Device IP:    ${ip}`)
      cy.task('log', `  Reset = OOB action ${PowerActions.Reset}`)
      cy.task('log', '  Disconnect check: ping must fail continuously for ≥7 s (within 30 s of command).')
      cy.task('log', '  Reconnect check:  ping must succeed again within 3 minutes.')

      // ── Step 1: Verify device is On via API ───────────────────────────────
      cy.task('log', `  Step 1: GET power/state — verifying device is On (${PowerStateValues.On}) …`)
      cy.request({
        method: 'GET',
        url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
        headers: authHeaders(),
        failOnStatusCode: false,
        timeout: 15000
      }).then((stateRes) => {
        const state = (stateRes.body as Record<string, number>).powerstate
        const label = PowerStateLabels[state] ?? `unknown(${state})`
        const statusLogChain = stateRes.status !== httpCodes.SUCCESS
          ? cy.task('log', `  ❌ Assertion failed: GET power/state must return HTTP 200 — got ${stateRes.status}`)
          : cy.wrap(null, { log: false })
        return statusLogChain
          .then(() => { expect(stateRes.status, 'GET power/state must return HTTP 200').to.eq(httpCodes.SUCCESS) })
          .then(() => cy.task('log', `  powerstate: ${state} (${label})`))
          .then(() => {
            if (state !== PowerStateValues.On) {
              return cy.task('log', `  ❌ Assertion failed: device must be On (${PowerStateValues.On}) before Reset — got ${state} (${label})`)
            }
            return cy.wrap(undefined, { log: false })
          })
          .then(() => { expect(state, `Device must be On before Reset — got ${state} (${label})`).to.eq(PowerStateValues.On) })
          .then(() => cy.task('log', '  ✅ Device is On'))
      })

      // ── Step 2: Ping pre-check ────────────────────────────────────────────
      // Confirms the test machine can reach the device via ICMP before we rely
      // on ping to detect the disconnect.  Fails fast if DEVICE_IP is wrong or
      // firewall blocks ICMP.
      cy.task('log', `  Step 2: Ping pre-check — verifying ${ip} is reachable …`)
      cy.task<PingResult>('ping', { host: ip }, { log: false, timeout: 10000 })
        .then((result) => {
          cy.task('log', `    [ping] ${new Date().toISOString()}  ${result.success ? '✓' : '✗'} ${ip}  (${result.durationMs}ms)  output: ${result.output}`)
          const logChain = !result.success
            ? cy.task('log', `  ❌ Assertion failed: ping pre-check — ${ip} must be reachable before Reset (got no reply). Check DEVICE_IP value and firewall.`)
            : cy.wrap(null, { log: false })
          logChain.then(() => {
            expect(result.success, `Ping pre-check: ${ip} must be reachable. Verify DEVICE_IP env var and that ICMP is not blocked.`).to.be.true
          })
          cy.task('log', '  ✅ Ping pre-check passed — device is reachable')
        })

      // ── Step 3: Send Reset command ────────────────────────────────────────
      cy.task('log', `  Step 3: POST power/action — sending Reset (action ${PowerActions.Reset}) …`)
      cy.request({
        method: 'POST',
        url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
        headers: authHeaders(),
        body: { action: PowerActions.Reset },
        failOnStatusCode: false,
        timeout: 15000
      }).then((actionRes) => {
        const body = actionRes.body as { Body?: { ReturnValue?: number; ReturnValueStr?: string } }
        const returnValue = body.Body?.ReturnValue
        const returnValueStr = body.Body?.ReturnValueStr ?? (returnValue === 0 ? 'SUCCESS' : `code ${returnValue}`)
        const statusLogChain = actionRes.status !== httpCodes.SUCCESS
          ? cy.task('log', `  ❌ Assertion failed: POST power/action must return HTTP 200 — got ${actionRes.status}`)
          : cy.wrap(null, { log: false })
        return statusLogChain
          .then(() => { expect(actionRes.status, 'POST power/action must return HTTP 200').to.eq(httpCodes.SUCCESS) })
          .then(() => cy.task('log', `  POST power/action → HTTP ${actionRes.status}, Body.ReturnValue=${returnValue} (${returnValueStr})`))
          .then(() => {
            if (returnValue !== 0) {
              return cy.task('log', `  ❌ Assertion failed: Body.ReturnValue must be 0 (SUCCESS) — got ${returnValue} (${returnValueStr})`)
            }
            return cy.wrap(undefined, { log: false })
          })
          .then(() => { expect(returnValue, `Body.ReturnValue must be 0 (SUCCESS) — got ${returnValue} (${returnValueStr})`).to.eq(0) })
          .then(() => cy.task('log', '  ✅ Reset command accepted (ReturnValue=0) — AMT is cutting main power rail …'))
      })

      // ── Step 4: Disconnect check ──────────────────────────────────────────
      // Start pinging immediately — no up-front wait.  The device drops off
      // the network within a second or two of the Reset command being received.
      cy.task('log', '  Step 4: Disconnect check — polling ping, requiring ≥7 s continuous failure …')
      cy.task('log', `         Host: ${ip}  |  Required: 7 s continuous failure  |  Timeout: 3 min`)
      cy.task('log', '         Each ping logged in real-time as [ping] lines.')

      waitForPingDisconnect(ip, 7000, 3 * 60 * 1000, 1000).then((r) => {
        cy.task('log', `  Disconnect check complete — ${r.attempts} ping(s) sent.`)
        if (r.confirmed) {
          cy.task('log', `  ✅ DISCONNECT CONFIRMED: ping failed continuously for ${(r.continuousFailMs / 1000).toFixed(1)}s (≥7s required)`)
        } else {
          cy.task('log', `  ❌ Assertion failed: disconnect NOT confirmed — best streak was ${(r.continuousFailMs / 1000).toFixed(1)}s (required ≥7s within 3 min)`)
        }
        expect(
          r.confirmed,
          `Disconnect check: ping to ${ip} must fail continuously for ≥7 s within 3 min of the Reset command. ` +
          `Best streak: ${(r.continuousFailMs / 1000).toFixed(1)}s`
        ).to.be.true
      })

      // ── Step 5: Reconnect wait ────────────────────────────────────────────
      cy.task('log', '  Step 5: Reconnect wait — polling ping every 2 s, max 3 minutes …')
      cy.task('log', `         Host: ${ip}`)

      waitForPingReconnect(ip, 3 * 60 * 1000, 2000).then((r) => {
        cy.task('log', `  Reconnect check complete — ${r.attempts} ping(s) sent.`)
        if (r.reconnected) {
          cy.task('log', `  ✅ RECONNECTED: ping to ${ip} succeeded after ${(r.elapsedMs / 1000).toFixed(1)}s`)
        } else {
          cy.task('log', `  ❌ Assertion failed: device did NOT reconnect within 3 minutes (${r.attempts} pings, all failed)`)
        }
        expect(
          r.reconnected,
          `Reconnect check: ping to ${ip} must succeed within 3 minutes. Elapsed: ${(r.elapsedMs / 1000).toFixed(1)}s`
        ).to.be.true
      })

      // ── Step 6: Verify AMT power state = On (2) via API (up to 3 attempts) ──
      // Retries up to 3 times (10 s apart) to allow AMT ME to re-establish its
      // CIRA session with MPS after the OS boots back up.
      cy.task('log', `  Step 6: GET power/state — expecting On (${PowerStateValues.On}), up to 3 attempts (10 s apart) …`)

      const checkPowerStateOnReset = (attempt: number, maxAttempts: number): Cypress.Chainable<void> => {
        return cy.request({
          method: 'GET',
          url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
          headers: authHeaders(),
          failOnStatusCode: false,
          timeout: 30000
        }).then((res): Cypress.Chainable<void> => {
          const state = (res.body as Record<string, number>).powerstate
          const label = PowerStateLabels[state] ?? `unknown(${state})`
          return (cy.task('log', `  Step 6 [attempt ${attempt}/${maxAttempts}]: HTTP ${res.status}, powerstate=${state} (${label})`)
            .then((): Cypress.Chainable<void> => {
              if (res.status === httpCodes.SUCCESS && state === PowerStateValues.On) {
                return cy.task('log', `  ✅ AMT power state confirmed On (${state}) — device fully back online`)
              }
              if (attempt < maxAttempts) {
                const reason = res.status !== httpCodes.SUCCESS
                  ? `HTTP ${res.status}`
                  : `powerstate=${state} (${label}), not On yet`
                return cy.task('log', `  ⚠️  ${reason} — retrying in 10 s (attempt ${attempt + 1}/${maxAttempts}) …`)
                  .then(() => cy.wait(10000, { log: false }))
                  .then(() => checkPowerStateOnReset(attempt + 1, maxAttempts))
              }
              const errorMsg = res.status !== httpCodes.SUCCESS
                ? `GET power/state must return HTTP 200 — got ${res.status}`
                : `powerstate must be On (${PowerStateValues.On}) after Reset — got ${state} (${label})`
              return cy.task('log', `  ❌ Assertion failed (all ${maxAttempts} attempts exhausted): ${errorMsg}`)
                .then(() => {
                  expect(res.status, 'GET power/state must return HTTP 200').to.eq(httpCodes.SUCCESS)
                  expect(state, `powerstate must be On (${PowerStateValues.On}) after Reset — got ${state} (${label})`).to.eq(PowerStateValues.On)
                  return cy.wrap(undefined as unknown as void, { log: false })
                })
            })) as Cypress.Chainable<void>
        })
      }

      checkPowerStateOnReset(1, 3)

      cy.task('log', '  ✅ TC_POWER_ACTION_RESET complete: disconnect ✓  reconnect ✓  powerstate=On ✓')
    }
  )
})
