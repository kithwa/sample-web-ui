/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Isolated run: TC_POWER_READ_CAPABILITIES only.
 * Shares the same helpers and before() logic as power-control.spec.ts
 * but skips every other context so the run is fast and targeted.
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import {
  PowerActions,
  PowerActionLabels
} from 'cypress/e2e/fixtures/api/power'

const mpsBaseUrl = (): string =>
  (Cypress.env('MPS_BASEURL') as string) ?? 'https://localhost:8181'

const mpsAuthBaseUrl = (): string =>
  (Cypress.env('MPS_AUTH_BASEURL') as string | undefined) ?? mpsBaseUrl()

let token = ''
let resolvedDeviceGuid = ''
const deviceGuid = (): string => resolvedDeviceGuid
const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${token}` })

// ─────────────────────────────────────────────────────────────────────────────

describe('TC_POWER_READ_CAPABILITIES - Get Power Capabilities via GET /api/v1/amt/power/capabilities/:guid', () => {
  let capabilities: Record<string, number> = {}

  before(function () {
    cy.task('log', '\n════════════════════════════════════════════════════════')
    cy.task('log', ' TC_POWER_READ_CAPABILITIES — isolated run')
    cy.task('log', `  MPS base:      ${mpsBaseUrl()}`)
    cy.task('log', `  MPS auth base: ${mpsAuthBaseUrl()}`)
    cy.task('log', '════════════════════════════════════════════════════════')

    // Step 1 — Authenticate
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
      cy.task('log', `  Auth → HTTP ${authRes.status}`)
      expect(authRes.status, 'MPS /api/v1/authorize must return 200').to.eq(httpCodes.SUCCESS)
      token = (authRes.body as Record<string, string>).token
      cy.task('log', '  ✅ JWT token obtained')

      // Step 2 — Resolve GUID
      const configuredGuid = ((Cypress.env('DEVICE_GUID') as string) ?? '').trim()
      if (configuredGuid) {
        resolvedDeviceGuid = configuredGuid
        cy.task('log', `  ✅ Using DEVICE_GUID: ${resolvedDeviceGuid}`)
        return
      }
      cy.task('log', '  DEVICE_GUID not set — auto-fetching first registered device …')
      cy.request({
        method: 'GET',
        url: `${mpsBaseUrl()}/api/v1/devices?$top=1&$skip=0&$count=true`,
        headers: authHeaders(),
        failOnStatusCode: false,
        timeout: 15000
      }).then((devRes) => {
        if (devRes.status !== httpCodes.SUCCESS) {
          cy.task('log', `  ⚠️  GET /api/v1/devices returned HTTP ${devRes.status} — skipping`)
          this.skip()
          return
        }
        const body = devRes.body as { data?: { guid: string }[] }
        if (!body.data?.length) {
          cy.task('log', '  ⚠️  No registered AMT devices — skipping')
          this.skip()
          return
        }
        resolvedDeviceGuid = body.data[0].guid
        cy.task('log', `  ✅ Auto-detected GUID: ${resolvedDeviceGuid}`)
      })
    })
  })

  // Fetch capabilities once for all individual its()
  beforeEach(function () {
    if (!resolvedDeviceGuid) {
      this.skip()
      return
    }
    cy.request({
      method: 'GET',
      url: `${mpsBaseUrl()}/api/v1/amt/power/capabilities/${deviceGuid()}`,
      headers: authHeaders(),
      failOnStatusCode: false,
      timeout: 15000
    }).then((res) => {
      cy.task('log', `  GET capabilities → HTTP ${res.status}  body: ${JSON.stringify(res.body)}`)
      expect(res.status, 'GET power/capabilities must return 200').to.eq(httpCodes.SUCCESS)
      capabilities = res.body as Record<string, number>
    })
  })

  // ── Individual capability assertions ────────────────────────────────────────

  it('TC_POWER_READ_CAPABILITIES_01: response HTTP 200 and body is an object', () => {
    expect(capabilities).to.be.an('object').and.not.be.empty
    cy.task('log', `  ✅ capabilities: ${JSON.stringify(capabilities)}`)
  })

  it('TC_POWER_READ_CAPABILITIES_02: Power up action code = 2', () => {
    expect(capabilities['Power up'], '"Power up" action code').to.eq(PowerActions.PowerUp)
    cy.task('log', `  ✅ "Power up" = ${capabilities['Power up']} (${PowerActionLabels[PowerActions.PowerUp]})`)
  })

  it('TC_POWER_READ_CAPABILITIES_03: Sleep action code = 4', () => {
    expect(capabilities['Sleep'], '"Sleep" action code').to.eq(PowerActions.Sleep)
    cy.task('log', `  ✅ "Sleep" = ${capabilities['Sleep']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_04: Power cycle action code = 5', () => {
    expect(capabilities['Power cycle'], '"Power cycle" action code').to.eq(PowerActions.PowerCycle)
    cy.task('log', `  ✅ "Power cycle" = ${capabilities['Power cycle']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_05: Hibernate action code = 7', () => {
    expect(capabilities['Hibernate'], '"Hibernate" action code').to.eq(PowerActions.Hibernate)
    cy.task('log', `  ✅ "Hibernate" = ${capabilities['Hibernate']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_06: Power down action code = 8', () => {
    expect(capabilities['Power down'], '"Power down" action code').to.eq(PowerActions.PowerDown)
    cy.task('log', `  ✅ "Power down" = ${capabilities['Power down']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_07: Reset action code = 10', () => {
    expect(capabilities['Reset'], '"Reset" action code').to.eq(PowerActions.Reset)
    cy.task('log', `  ✅ "Reset" = ${capabilities['Reset']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_08: Soft-off action code = 12', () => {
    expect(capabilities['Soft-off'], '"Soft-off" action code').to.eq(PowerActions.SoftOff)
    cy.task('log', `  ✅ "Soft-off" = ${capabilities['Soft-off']}`)
  })

  it('TC_POWER_READ_CAPABILITIES_09: Soft-reset action code = 14', () => {
    expect(capabilities['Soft-reset'], '"Soft-reset" action code').to.eq(PowerActions.SoftReset)
    cy.task('log', `  ✅ "Soft-reset" = ${capabilities['Soft-reset']}`)
  })
})
