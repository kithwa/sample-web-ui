/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * AMT Power Control — Functional Tests
 *
 * Exercises end-to-end functional correctness of AMT power control operations
 * via the MPS Console REST API, verifying that each power action is accepted
 * and (for OOB operations) that the device transitions through the expected
 * power states.
 *
 * Every API call is logged in real-time to:
 *   • The Cypress runner (cy.log)
 *   • Terminal stdout  (via cy.task('log'))
 *   • A timestamped file under cypress/logs/  (via cy.task('log'))
 *
 * Prerequisites:
 *   • DEVICE_GUID env var (or auto-detection) must resolve to a registered AMT device.
 *   • Console backend running on MPS_BASEURL (default: https://localhost:8181).
 *   • MPS_USERNAME / MPS_PASSWORD must be valid MPS console credentials.
 *
 * Run with:
 *   npx cypress run --config-file cypress.config.ts \
 *     --spec "cypress/e2e/integration/power-control/power-control.spec.ts"
 *
 * ─── Operations tested ────────────────────────────────────────────────────────
 *   TC_POWER_READ_STATE        GET  current power state
 *   TC_POWER_READ_CAPABILITIES GET  available power action codes
 *   TC_POWER_ACTION_SLEEP      Web UI dropdown → Sleep      (action  4) — in-band, 3 min wait
 *   TC_POWER_ACTION_HIBERNATE  Web UI dropdown → Hibernate  (action  7) — in-band, 3 min wait
 *   TC_POWER_ACTION_SOFT_OFF   POST Soft-Off     (action 12) — in-band/OOB
 *   TC_POWER_ACTION_SOFT_RESET POST Soft Reset   (action 14) — in-band/OOB
 *   TC_POWER_ACTION_RESET      POST Reset        (action 10) — OOB hard
 *   TC_POWER_ACTION_POWER_CYCLE POST Power Cycle (action  5) — OOB hard
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTE on in-band operations (Sleep, Hibernate, Soft-Off, Soft Reset):
 *   These rely on the OS to handle ACPI signals. If the OS is not configured
 *   to respond, the API will still return HTTP 200 / ReturnValue=0 but the
 *   device power state may not change. Tests verify the API response and
 *   restore the device to On regardless of the OS behaviour.
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import {
  PowerActions,
  PowerStateValues,
  PowerActionLabels,
  PowerStateLabels,
  OFF_STATES,
  SLEEP_STATES
} from 'cypress/e2e/fixtures/api/power'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mpsBaseUrl = (): string => Cypress.env('MPS_BASEURL') as string ?? 'https://localhost:8181'

/**
 * Base URL used specifically for the /api/v1/authorize call.
 * In the cloud (Kong) deployment the auth endpoint lives under a different
 * prefix than the device APIs:
 *   APIs:  https://<host>/mps/api/v1/...
 *   Auth:  https://<host>/mps/login/api/v1/authorize
 * Set MPS_AUTH_BASEURL=https://<host>/mps/login to override.
 * Defaults to mpsBaseUrl() so local console deployments need no change.
 */
const mpsAuthBaseUrl = (): string =>
  (Cypress.env('MPS_AUTH_BASEURL') as string | undefined) ?? mpsBaseUrl()

/**
 * Resolved AMT device GUID — populated in before() from the DEVICE_GUID env var.
 * If DEVICE_GUID is empty or not set, the first registered device is auto-fetched
 * from GET /api/v1/devices after authentication.
 */
let resolvedDeviceGuid = ''
const deviceGuid = (): string => resolvedDeviceGuid

/** Interval between state-poll requests */
const POLL_INTERVAL_MS = 10_000
/** Max time to wait for a device to power ON (boot takes ~3 min) */
const POWER_ON_TIMEOUT_MS = 4 * 60 * 1000
/** Max time to wait for a device to power OFF (OOB cut is near-instant) */
const POWER_OFF_TIMEOUT_MS = 90_000
/** Max time spent in pre-flight device-readiness check */
const PREFLIGHT_TIMEOUT_MS = 2 * 60 * 1000
/** Fixed wait after a hard power action before starting to poll */
const POST_RESET_SETTLE_MS = 30_000
/** Fixed wait after a graceful shutdown/restart before starting to poll */
const POST_SOFT_ACTION_SETTLE_MS = 15_000

// ─────────────────────────────────────────────────────────────────────────────

describe('Functional Tests - AMT Power Control via MPS Console REST API', () => {
  // JWT token shared across all tests — obtained in before()
  let token = ''

  /** Returns Authorization header using the current JWT token */
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${token}`
  })

  /**
   * Wrapper around cy.request() that logs each call and its response to
   * cy.log and cy.task('log') (stdout + timestamped log file).
   */
  const loggedRequest = (
    label: string,
    options: Partial<Cypress.RequestOptions> & { url: string }
  ): Cypress.Chainable<Cypress.Response<unknown>> => {
    const method = (options.method ?? 'GET') as string
    const bodyStr = options.body != null ? `  body: ${JSON.stringify(options.body)}` : ''
    cy.task('log', `  [${label}] → ${method} ${options.url}${bodyStr}`)
    cy.log(`→ **${method}** \`${label}\``)
    return cy
      .request({ failOnStatusCode: false, timeout: 20000, ...options } as Cypress.RequestOptions)
      .then((res) => {
        const preview = JSON.stringify(res.body).slice(0, 400)
        cy.task('log', `  [${label}] ← ${res.status}  ${preview}`)
        cy.log(`← **${res.status}**`)
        return cy.wrap(res)
      })
  }

  /**
   * Recursively polls GET /api/v1/amt/power/state/{guid} until the reported
   * powerstate matches one of the provided targetStates.
   * Treats 5xx as transient (device recovering) and keeps retrying.
   * Throws (fails the test) when the deadline is exceeded.
   */
  const pollMpsPowerState = (
    targetStates: number[],
    deadline: number = Date.now() + POWER_ON_TIMEOUT_MS
  ): void => {
    const labels = targetStates.map((s) => PowerStateLabels[s] ?? s).join(' | ')
    loggedRequest(`POLL→[${labels}]`, {
      method: 'GET',
      url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
      headers: authHeaders(),
      failOnStatusCode: false
    }).then((res) => {
      // 5xx means device is temporarily unreachable (e.g. firmware update, reboot in progress)
      if (res.status !== httpCodes.SUCCESS) {
        cy.task('log', `    ⏳ HTTP ${res.status} — device recovering, retrying …`)
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for powerstate [${targetStates}]. Last HTTP: ${res.status}`
          )
        }
        cy.wait(POLL_INTERVAL_MS)
        pollMpsPowerState(targetStates, deadline)
        return
      }
      const current = (res.body as Record<string, number>).powerstate
      const stateLabel = PowerStateLabels[current] ?? `state=${current}`
      cy.task('log', `    powerstate: ${current} (${stateLabel})  target: [${labels}]`)
      if (targetStates.includes(current)) {
        cy.task('log', `    ✅ powerstate reached: ${current} (${stateLabel})`)
        return
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for powerstate in [${targetStates}]. Last: ${current} (${stateLabel})`
        )
      }
      cy.wait(POLL_INTERVAL_MS)
      pollMpsPowerState(targetStates, deadline)
    })
  }

  /**
   * Ensures the device is powered On (powerstate=2) before a test starts.
   *
   * State handling:
   *   On (2)              → nothing to do, proceed immediately
   *   Sleep S1/S2/S3 (3/4) → POST OsToFullPower (500), poll until On
   *   Hibernate S4 (6)    → POST PowerUp (2), settle wait, poll until On
   *   Off S5+ (7/8/9)     → POST PowerUp (2), settle wait, poll until On
   *   Unknown (0)         → attempt PowerUp as best-effort
   *
   * Retries on transient 5xx (device firmware recovering) up to PREFLIGHT_TIMEOUT_MS.
   * Throws if the device cannot be reached with a non-5xx error.
   */
  const ensureDeviceOn = (deadline: number = Date.now() + PREFLIGHT_TIMEOUT_MS): void => {
    cy.task('log', '\n── Pre-flight: ensure device is On ──')
    loggedRequest('Pre-flight GET', {
      method: 'GET',
      url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
      headers: authHeaders(),
      failOnStatusCode: false
    }).then((res) => {
      // Transient 5xx — firmware still recovering from a previous power action
      if (res.status >= 500) {
        cy.task('log', `  ⏳ HTTP ${res.status} — recovering, retrying in ${POLL_INTERVAL_MS / 1000}s …`)
        if (Date.now() >= deadline) {
          throw new Error(`Pre-flight deadline exceeded after repeated HTTP ${res.status}`)
        }
        cy.wait(POLL_INTERVAL_MS)
        ensureDeviceOn(deadline)
        return
      }
      if (res.status !== httpCodes.SUCCESS) {
        throw new Error(
          `Pre-flight: device unavailable (HTTP ${res.status}). Check DEVICE_GUID env var (GUID: ${deviceGuid()})`
        )
      }

      const state = (res.body as Record<string, number>).powerstate
      const stateLabel = PowerStateLabels[state] ?? `unknown (${state})`
      cy.task('log', `  Current powerstate: ${state} (${stateLabel})`)

      // ── Already On ──────────────────────────────────────────────────────────
      if (state === PowerStateValues.On) {
        cy.task('log', '  ✅ Device is already On — ready')
        return
      }

      // ── Sleep S1/S2/S3 — wake with OsToFullPower ───────────────────────────
      if (SLEEP_STATES.includes(state)) {
        cy.task('log', `  Device is ${stateLabel} — sending OsToFullPower (action ${PowerActions.OsToFullPower}) to wake …`)
        loggedRequest(`Power On: OsToFullPower (action ${PowerActions.OsToFullPower})`, {
          method: 'POST',
          url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
          headers: authHeaders(),
          body: { action: PowerActions.OsToFullPower },
          failOnStatusCode: false
        }).then((wakeRes) => {
          if (wakeRes.status === httpCodes.SUCCESS) {
            cy.task('log', `  ✅ OsToFullPower accepted (HTTP ${wakeRes.status}, ReturnValue=${(wakeRes.body as Record<string, number>).ReturnValue ?? '?'})`)
          } else {
            cy.task('log', `  ⚠️  OsToFullPower returned HTTP ${wakeRes.status} — will still poll …`)
          }
          cy.task('log', `  Polling for On state (max ${POWER_ON_TIMEOUT_MS / 1000}s) …`)
          pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
        })
        return
      }

      // ── Hibernate (S4), Off (S5+), or Unknown — power up with PowerUp ──────
      const reason = PowerStateValues.Hibernate === state
        ? 'Hibernate (S4)'
        : OFF_STATES.includes(state)
          ? `Off (${stateLabel})`
          : `Unknown state ${state}`
      cy.task('log', `  Device is ${reason} — sending PowerUp (action ${PowerActions.PowerUp}) …`)
      loggedRequest(`Power On: PowerUp (action ${PowerActions.PowerUp})`, {
        method: 'POST',
        url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
        headers: authHeaders(),
        body: { action: PowerActions.PowerUp },
        failOnStatusCode: false
      }).then((powerOnRes) => {
        if (powerOnRes.status === httpCodes.SUCCESS) {
          cy.task('log', `  ✅ PowerUp accepted (HTTP ${powerOnRes.status}, ReturnValue=${(powerOnRes.body as Record<string, number>).ReturnValue ?? '?'})`)
        } else {
          cy.task('log', `  ⚠️  PowerUp returned HTTP ${powerOnRes.status} — will still poll …`)
        }
        cy.task('log', `  Settle wait (${POST_RESET_SETTLE_MS / 1000}s before polling) …`)
        cy.wait(POST_RESET_SETTLE_MS)
        cy.task('log', `  Polling for On state (max ${POWER_ON_TIMEOUT_MS / 1000}s) …`)
        pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
        cy.task('log', '  ✅ Device is On — ready')
      })
    })
  }

  // ─── Authentication + Device GUID resolution ────────────────────────────────
  //
  // 1. Authenticate with MPS Console and obtain a JWT token.
  // 2. Resolve the target device GUID:
  //    a. If DEVICE_GUID env var is non-empty, use it directly.
  //    b. Otherwise, call GET /api/v1/devices?$top=1&$skip=0&$count=true and
  //       use the first registered device's GUID (auto-detection).
  // 3. Skip the entire suite if no device GUID can be determined.

  before(function () {
    cy.task('log', '\n════════════════════════════════════════════════════════')
    cy.task('log', ' AMT Power Control — Functional Tests')
    cy.task('log', `  MPS base: ${mpsBaseUrl()}`)
    cy.task('log', '════════════════════════════════════════════════════════')
    cy.task('log', '\n── Step 1: Authenticate with MPS Console backend ──')

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
      expect(authRes.status, 'MPS /api/v1/authorize must return 200').to.eq(httpCodes.SUCCESS)
      token = (authRes.body as Record<string, string>).token
      cy.task('log', '  ✅ JWT token obtained')

      // ── Step 2: Resolve device GUID ──────────────────────────────────────
      cy.task('log', '\n── Step 2: Resolve AMT device GUID ──')
      const configuredGuid = ((Cypress.env('DEVICE_GUID') as string) ?? '').trim()

      if (configuredGuid) {
        resolvedDeviceGuid = configuredGuid
        cy.task('log', `  ✅ Using DEVICE_GUID from env: ${resolvedDeviceGuid}`)
        cy.task('log', '════════════════════════════════════════════════════════')
        return
      }

      // Auto-detect: fetch the first registered device from MPS Console
      cy.task('log', '  DEVICE_GUID not set — auto-fetching first registered device …')
      cy.request({
        method: 'GET',
        url: `${mpsBaseUrl()}/api/v1/devices?$top=1&$skip=0&$count=true`,
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
        timeout: 15000
      }).then((devRes) => {
        if (devRes.status !== httpCodes.SUCCESS) {
          cy.task('log', `  ⚠️  GET /api/v1/devices returned HTTP ${devRes.status} — skipping all tests`)
          this.skip()
          return
        }
        const body = devRes.body as { data?: { guid: string }[]; totalCount?: number }
        if (!body.data?.length) {
          cy.task('log', '  ⚠️  No registered AMT devices found in MPS Console — skipping all tests')
          this.skip()
          return
        }
        resolvedDeviceGuid = body.data[0].guid
        cy.task(
          'log',
          `  ✅ Auto-detected device GUID: ${resolvedDeviceGuid}` +
            `  (${body.totalCount ?? '?'} device(s) total in MPS Console)`
        )
        cy.task('log', '════════════════════════════════════════════════════════')
      })
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_READ_STATE — Show Current Power State
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_READ_STATE - Show Current Power State via GET /api/v1/amt/power/state/:guid',
    () => {
      it('returns HTTP 200 with powerstate and osPowerSavingState numeric fields', () => {
        cy.task('log', '\n── TC_POWER_READ_STATE: GET power state ──')
        loggedRequest('GET power/state', {
          method: 'GET',
          url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
          headers: authHeaders()
        }).then((res) => {
          expect(res.status, 'GET power/state must return 200').to.eq(httpCodes.SUCCESS)
          expect(res.body, 'Response must include powerstate field').to.have.property('powerstate')
          expect(res.body, 'Response must include osPowerSavingState field').to.have.property(
            'osPowerSavingState'
          )
          const state = (res.body as Record<string, number>).powerstate
          const osState = (res.body as Record<string, number>).osPowerSavingState
          expect(state, 'powerstate must be a non-negative integer').to.be.a('number').and.gte(0)
          expect(osState, 'osPowerSavingState must be a non-negative integer')
            .to.be.a('number')
            .and.gte(0)
          cy.task('log', `  ✅ powerstate: ${state} (${PowerStateLabels[state] ?? 'unknown'})`)
          cy.task('log', `  ✅ osPowerSavingState: ${osState}`)
        })
      })
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_READ_CAPABILITIES — Get Available Power Capabilities
  //
  // Fetches the capabilities object once (before()) and then verifies in each
  // it() that a specific expected power action is present with the correct code.
  //
  // JSON field names come from the Go DTO struct tags in
  //   console/internal/entity/dto/v1/powercapabilities.go
  // Action code values are confirmed by
  //   console/internal/usecase/devices/power_private_test.go  (AMT v10 fixture)
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_READ_CAPABILITIES - Get Power Capabilities via GET /api/v1/amt/power/capabilities/:guid',
    () => {
      // Shared capabilities object populated in before()
      let caps: Record<string, number> = {}

      before(() => {
        cy.task('log', '\n── TC_POWER_READ_CAPABILITIES: GET power capabilities ──')
        loggedRequest('GET power/capabilities', {
          method: 'GET',
          url: `${mpsBaseUrl()}/api/v1/amt/power/capabilities/${deviceGuid()}`,
          headers: authHeaders()
        }).then((res) => {
          expect(res.status, 'GET power/capabilities must return 200').to.eq(httpCodes.SUCCESS)
          caps = res.body as Record<string, number>
          cy.task('log', '  ✅ Capabilities received:')
          Object.entries(caps).forEach(([name, code]) => {
            cy.task('log', `     "${name}": ${code}  (${PowerActionLabels[code] ?? 'unknown'})`)
          })
        })
      })

      // ── Baseline OOB capability ─────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_01 - reports "Power up" capability with action code 2',
        () => {
          expect(caps, 'Capabilities must include "Power up"').to.have.property('Power up')
          expect(caps['Power up'], '"Power up" action code must be 2').to.eq(PowerActions.PowerUp)
          cy.task('log', `  ✅ "Power up": ${caps['Power up']}`)
        }
      )

      // ── In-band sleep ────────────────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_02 - reports "Sleep" capability with action code 4',
        () => {
          expect(caps, 'Capabilities must include "Sleep"').to.have.property('Sleep')
          expect(caps['Sleep'], '"Sleep" action code must be 4').to.eq(PowerActions.Sleep)
          cy.task('log', `  ✅ "Sleep": ${caps['Sleep']}`)
        }
      )

      // ── OOB power cycle ──────────────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_03 - reports "Power cycle" capability with action code 5',
        () => {
          expect(caps, 'Capabilities must include "Power cycle"').to.have.property('Power cycle')
          expect(caps['Power cycle'], '"Power cycle" action code must be 5').to.eq(PowerActions.PowerCycle)
          cy.task('log', `  ✅ "Power cycle": ${caps['Power cycle']}`)
        }
      )

      // ── In-band hibernate ────────────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_04 - reports "Hibernate" capability with action code 7',
        () => {
          expect(caps, 'Capabilities must include "Hibernate"').to.have.property('Hibernate')
          expect(caps['Hibernate'], '"Hibernate" action code must be 7').to.eq(PowerActions.Hibernate)
          cy.task('log', `  ✅ "Hibernate": ${caps['Hibernate']}`)
        }
      )

      // ── OOB hard power off ───────────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_05 - reports "Power down" capability with action code 8',
        () => {
          expect(caps, 'Capabilities must include "Power down"').to.have.property('Power down')
          expect(caps['Power down'], '"Power down" action code must be 8').to.eq(PowerActions.PowerDown)
          cy.task('log', `  ✅ "Power down": ${caps['Power down']}`)
        }
      )

      // ── OOB hard reset ───────────────────────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_06 - reports "Reset" capability with action code 10',
        () => {
          expect(caps, 'Capabilities must include "Reset"').to.have.property('Reset')
          expect(caps['Reset'], '"Reset" action code must be 10').to.eq(PowerActions.Reset)
          cy.task('log', `  ✅ "Reset": ${caps['Reset']}`)
        }
      )

      // ── In-band / OOB graceful shutdown ─────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_07 - reports "Soft-off" capability with action code 12',
        () => {
          expect(caps, 'Capabilities must include "Soft-off"').to.have.property('Soft-off')
          expect(caps['Soft-off'], '"Soft-off" action code must be 12').to.eq(PowerActions.SoftOff)
          cy.task('log', `  ✅ "Soft-off": ${caps['Soft-off']}`)
        }
      )

      // ── In-band / OOB graceful restart ──────────────────────────────────────
      it(
        'TC_POWER_READ_CAPABILITIES_08 - reports "Soft-reset" capability with action code 14',
        () => {
          expect(caps, 'Capabilities must include "Soft-reset"').to.have.property('Soft-reset')
          expect(caps['Soft-reset'], '"Soft-reset" action code must be 14').to.eq(PowerActions.SoftReset)
          cy.task('log', `  ✅ "Soft-reset": ${caps['Soft-reset']}`)
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_SLEEP — Sleep (In-band, action 4)
  //
  // Triggers Sleep via the Web UI "more_vert" dropdown menu on the device detail
  // page, waits 3 minutes for the OS to respond, then verifies AMT power state
  // via API. Wakes device back to On with OsToFullPower at the end.
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_SLEEP - Perform Sleep (in-band) via Web UI dropdown menu',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'clicks Sleep in the Web UI dropdown — waits 3 min — verifies AMT powerstate via API, wakes device back to On',
        function () {
          this.timeout(15 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_SLEEP (Web UI) ──')

          const webUiBaseUrl = (Cypress.env('BASEURL') as string) ?? 'http://localhost:4200/'
          const devicePageUrl = `${webUiBaseUrl.replace(/\/$/, '')}/devices/${deviceGuid()}`
          cy.task('log', `  Navigating to device page: ${devicePageUrl}`)

          // ── Step 1: Navigate to device detail page ─────────────────────────
          cy.visit(devicePageUrl)
          cy.task('log', '  ✅ Device detail page loaded')

          // ── Step 2: Open "more_vert" dropdown menu ─────────────────────────
          cy.task('log', '  Opening power options menu (more_vert) …')
          cy.get('mat-toolbar button[mat-icon-button]').last().click()
          cy.wait(500)
          cy.task('log', '  ✅ Power options menu opened')

          // ── Step 3: Click "Sleep" in the dropdown ──────────────────────────
          cy.task('log', '  Clicking "Sleep" menu item …')
          cy.contains('Sleep', { timeout: 8000 }).click()
          cy.task('log', '  ✅ "Sleep" clicked — AMT sending ACPI Sleep signal to OS')

          // ── Step 4: Wait 3 minutes for OS to respond ───────────────────────
          const waitMs = 3 * 60 * 1000
          cy.task('log', `  Waiting ${waitMs / 1000}s (3 min) for OS to process Sleep signal …`)
          cy.wait(waitMs)
          cy.task('log', '  ✅ Wait complete — checking AMT power state via API')

          // ── Step 5: Verify AMT power state via API ─────────────────────────
          loggedRequest('GET power/state after Sleep', {
            method: 'GET',
            url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
            headers: authHeaders()
          }).then((res) => {
            expect(res.status, 'GET power/state must return HTTP 200').to.eq(httpCodes.SUCCESS)
            const state = (res.body as Record<string, number>).powerstate
            cy.task('log', `  powerstate: ${state} (${PowerStateLabels[state] ?? 'unknown'})`)
            // Accept Sleep states OR On (if OS did not honour the in-band signal)
            expect(
              SLEEP_STATES.includes(state) || state === PowerStateValues.On,
              `powerstate ${state} must be Sleep (3/4) or On (2) — in-band signal is OS-dependent`
            ).to.be.true
            cy.task('log', `  ✅ Power state verified: ${state} (${PowerStateLabels[state] ?? 'unknown'})`)
          })

          // ── Step 6: Wake device back to On via API ─────────────────────────
          cy.task('log', `  Waking device: POST OsToFullPower (action ${PowerActions.OsToFullPower})`)
          loggedRequest(`POST OsToFullPower (action ${PowerActions.OsToFullPower})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.OsToFullPower }
          }).then((wakeRes) => {
            expect(wakeRes.status, 'OsToFullPower must return HTTP 200').to.eq(httpCodes.SUCCESS)
            cy.task('log', '  Polling for On state after wake …')
            pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
            cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_SLEEP complete')
          })
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_HIBERNATE — Hibernate (In-band, action 7)
  //
  // Triggers Hibernate via the Web UI "more_vert" dropdown menu on the device
  // detail page, waits 3 minutes for the OS to write RAM to disk and power off
  // (S4), then verifies AMT power state via API. Restores with PowerUp.
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_HIBERNATE - Perform Hibernate (in-band) via Web UI dropdown menu',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'clicks Hibernate in the Web UI dropdown — waits 3 min — verifies AMT powerstate via API, restores to On',
        function () {
          this.timeout(15 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_HIBERNATE (Web UI) ──')

          const webUiBaseUrl = (Cypress.env('BASEURL') as string) ?? 'http://localhost:4200/'
          const devicePageUrl = `${webUiBaseUrl.replace(/\/$/, '')}/devices/${deviceGuid()}`
          cy.task('log', `  Navigating to device page: ${devicePageUrl}`)

          // ── Step 1: Navigate to device detail page ─────────────────────────
          cy.visit(devicePageUrl)
          cy.task('log', '  ✅ Device detail page loaded')

          // ── Step 2: Open "more_vert" dropdown menu ─────────────────────────
          cy.task('log', '  Opening power options menu (more_vert) …')
          cy.get('mat-toolbar button[mat-icon-button]').last().click()
          cy.wait(500)
          cy.task('log', '  ✅ Power options menu opened')

          // ── Step 3: Click "Hibernate" in the dropdown ──────────────────────
          cy.task('log', '  Clicking "Hibernate" menu item …')
          cy.contains('Hibernate', { timeout: 8000 }).click()
          cy.task('log', '  ✅ "Hibernate" clicked — AMT sending ACPI Hibernate (S4) signal to OS')

          // ── Step 4: Wait 3 minutes for OS to respond ───────────────────────
          const waitMs = 3 * 60 * 1000
          cy.task('log', `  Waiting ${waitMs / 1000}s (3 min) for OS to process Hibernate signal …`)
          cy.wait(waitMs)
          cy.task('log', '  ✅ Wait complete — checking AMT power state via API')

          // ── Step 5: Verify AMT power state via API ─────────────────────────
          loggedRequest('GET power/state after Hibernate', {
            method: 'GET',
            url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
            headers: authHeaders()
          }).then((res) => {
            expect(res.status, 'GET power/state must return HTTP 200').to.eq(httpCodes.SUCCESS)
            const state = (res.body as Record<string, number>).powerstate
            cy.task('log', `  powerstate: ${state} (${PowerStateLabels[state] ?? 'unknown'})`)
            // Accept Hibernate (6), Off states (7/8/9), or On (2) if OS didn't respond
            expect(
              state === PowerStateValues.Hibernate || OFF_STATES.includes(state) || state === PowerStateValues.On,
              `powerstate ${state} must be Hibernate (6), Off (7/8/9), or On (2) — in-band signal is OS-dependent`
            ).to.be.true
            cy.task('log', `  ✅ Power state verified: ${state} (${PowerStateLabels[state] ?? 'unknown'})`)
          })

          // ── Step 6: Restore device to On via OOB PowerUp ───────────────────
          cy.task('log', `  Restoring device: POST PowerUp (action ${PowerActions.PowerUp})`)
          loggedRequest(`POST PowerUp (action ${PowerActions.PowerUp})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.PowerUp }
          }).then((powerUpRes) => {
            expect(powerUpRes.status, 'PowerUp must return HTTP 200').to.eq(httpCodes.SUCCESS)
            cy.task('log', `  Settle wait (${POST_RESET_SETTLE_MS / 1000}s) …`)
            cy.wait(POST_RESET_SETTLE_MS)
            cy.task('log', '  Polling for On state …')
            pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
            cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_HIBERNATE complete')
          })
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_SOFT_OFF — Soft-Off (In-band/OOB, action 12)
  //
  // Sends a graceful OS shutdown signal (ACPI S5). Recovery: PowerUp (action 2).
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_SOFT_OFF - Perform Soft-Off via POST /api/v1/amt/power/action/:guid',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'sends Soft-Off (action 12) — returns HTTP 200 with ReturnValue=0 (OS ACPI shutdown; best-effort state verification)',
        function () {
          this.timeout(15 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_SOFT_OFF ──')

          loggedRequest(`POST Soft-Off (action ${PowerActions.SoftOff})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.SoftOff }
          }).then((res) => {
            expect(res.status, 'Soft-Off action must return HTTP 200').to.eq(httpCodes.SUCCESS)
            expect(
              (res.body as Record<string, number>).ReturnValue,
              'Soft-Off ReturnValue must be 0 (success)'
            ).to.eq(0)
            cy.task('log', '  ✅ Soft-Off command accepted (HTTP 200, ReturnValue=0)')
            cy.task('log', '  ℹ  Soft-Off is in-band (OS ACPI S5) — whether OS shuts down depends on OS ACPI config.')

            // Give OS time to begin graceful shutdown
            cy.task('log', `  Settle wait (${POST_SOFT_ACTION_SETTLE_MS / 1000}s before polling) …`)
            cy.wait(POST_SOFT_ACTION_SETTLE_MS)

            // Best-effort: check state once after settle. Soft-Off is in-band (OS ACPI S5).
            // If the OS ignores the ACPI signal the device stays On — that is OS-dependent
            // behaviour, not an AMT firmware failure. Core assertion is ReturnValue=0.
            cy.task('log', '  Best-effort: checking state once after settle …')
            loggedRequest('GET power/state (post soft-off check)', {
              method: 'GET',
              url: `${mpsBaseUrl()}/api/v1/amt/power/state/${deviceGuid()}`,
              headers: authHeaders(),
              failOnStatusCode: false
            }).then((stateRes) => {
              if (stateRes.status === httpCodes.SUCCESS) {
                const ps = (stateRes.body as Record<string, number>).powerstate
                if (OFF_STATES.includes(ps)) {
                  cy.task('log', `  ✅ Device is Off (powerstate ${ps}) — OS responded to ACPI S5 signal`)
                } else {
                  cy.task(
                    'log',
                    `  ⚠  Device remains in state ${ps} (${PowerStateLabels[ps] ?? ps}) — OS did not respond to ACPI soft-off signal (environment-dependent)`
                  )
                }
              } else {
                cy.task('log', `  ⚠  State poll returned HTTP ${stateRes.status} — device may be transitioning`)
              }
            })

            // Always restore device to On
            cy.task('log', `\n  Restoring device: POST PowerUp (action ${PowerActions.PowerUp})`)
            loggedRequest(`POST PowerUp (action ${PowerActions.PowerUp})`, {
              method: 'POST',
              url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
              headers: authHeaders(),
              body: { action: PowerActions.PowerUp }
            }).then((powerUpRes) => {
              expect(powerUpRes.status, 'PowerUp must return HTTP 200').to.eq(httpCodes.SUCCESS)
              cy.task('log', `  Settle wait (${POST_RESET_SETTLE_MS / 1000}s) …`)
              cy.wait(POST_RESET_SETTLE_MS)
              cy.task('log', '  Polling for On state …')
              pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
              cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_SOFT_OFF complete')
            })
          })
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_SOFT_RESET — Soft Reset (In-band/OOB, action 14)
  //
  // Sends a graceful OS restart signal. Device restarts and returns to On.
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_SOFT_RESET - Perform Soft Reset via POST /api/v1/amt/power/action/:guid',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'sends Soft Reset (action 14) — returns HTTP 200 with ReturnValue=0, device comes back to On',
        function () {
          this.timeout(12 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_SOFT_RESET ──')

          loggedRequest(`POST Soft Reset (action ${PowerActions.SoftReset})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.SoftReset }
          }).then((res) => {
            expect(res.status, 'Soft Reset action must return HTTP 200').to.eq(httpCodes.SUCCESS)
            expect(
              (res.body as Record<string, number>).ReturnValue,
              'Soft Reset ReturnValue must be 0 (success)'
            ).to.eq(0)
            cy.task('log', '  ✅ Soft Reset command accepted (HTTP 200, ReturnValue=0)')

            // Give OS time to begin restart
            cy.task('log', `  Settle wait (${POST_SOFT_ACTION_SETTLE_MS / 1000}s) …`)
            cy.wait(POST_SOFT_ACTION_SETTLE_MS)

            // Poll until device is back On
            cy.task('log', '  Polling for On state (device restarting) …')
            pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
            cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_SOFT_RESET complete')
          })
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_RESET — Reset / Hard Reset (OOB, action 10)
  //
  // Sends a hardware-level reset signal — immediate, no OS involvement.
  // Device reboots and returns to On.
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_RESET - Perform Reset (OOB hard reset) via POST /api/v1/amt/power/action/:guid',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'sends Reset (action 10) — returns HTTP 200 with ReturnValue=0, device comes back to On',
        function () {
          this.timeout(10 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_RESET ──')

          loggedRequest(`POST Reset (action ${PowerActions.Reset})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.Reset }
          }).then((res) => {
            expect(res.status, 'Reset action must return HTTP 200').to.eq(httpCodes.SUCCESS)
            expect(
              (res.body as Record<string, number>).ReturnValue,
              'Reset ReturnValue must be 0 (success)'
            ).to.eq(0)
            cy.task('log', '  ✅ Reset command accepted (HTTP 200, ReturnValue=0)')

            cy.task('log', `  Settle wait (${POST_RESET_SETTLE_MS / 1000}s) …`)
            cy.wait(POST_RESET_SETTLE_MS)

            cy.task('log', '  Polling for On state (device rebooting) …')
            pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
            cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_RESET complete')
          })
        }
      )
    }
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // TC_POWER_ACTION_POWER_CYCLE — Power Cycle (OOB, action 5)
  //
  // Hard power cycle: immediate power cut then power on. No OS involvement.
  // Device transitions Off → On.
  // ══════════════════════════════════════════════════════════════════════════════
  context(
    'TC_POWER_ACTION_POWER_CYCLE - Perform Power Cycle (OOB) via POST /api/v1/amt/power/action/:guid',
    () => {
      beforeEach(() => {
        ensureDeviceOn()
      })

      it(
        'sends Power Cycle (action 5) — returns HTTP 200 with ReturnValue=0, device comes back to On',
        function () {
          this.timeout(12 * 60 * 1000)
          cy.task('log', '\n── TC_POWER_ACTION_POWER_CYCLE ──')

          loggedRequest(`POST Power Cycle (action ${PowerActions.PowerCycle})`, {
            method: 'POST',
            url: `${mpsBaseUrl()}/api/v1/amt/power/action/${deviceGuid()}`,
            headers: authHeaders(),
            body: { action: PowerActions.PowerCycle }
          }).then((res) => {
            expect(res.status, 'Power Cycle action must return HTTP 200').to.eq(httpCodes.SUCCESS)
            expect(
              (res.body as Record<string, number>).ReturnValue,
              'Power Cycle ReturnValue must be 0 (success)'
            ).to.eq(0)
            cy.task('log', '  ✅ Power Cycle command accepted (HTTP 200, ReturnValue=0)')
            cy.task('log', '  ℹ  OOB Power Cycle: Off→On transition is near-instant; polling for Off state is unreliable.')

            // OOB power cycle: hard power cut + immediate restart managed entirely by AMT firmware.
            // The Off state lasts only ~1–2 s — far shorter than the 10 s poll interval — so
            // intermediate Off detection is skipped. We simply wait for the device to boot back On.
            cy.task('log', `  Settle wait (${POST_RESET_SETTLE_MS / 1000}s for boot) …`)
            cy.wait(POST_RESET_SETTLE_MS)

            cy.task('log', '  Polling for On state (boot phase) …')
            pollMpsPowerState([PowerStateValues.On], Date.now() + POWER_ON_TIMEOUT_MS)
            cy.task('log', '  ✅ Device is On — TC_POWER_ACTION_POWER_CYCLE complete')
          })
        }
      )
    }
  )
})
