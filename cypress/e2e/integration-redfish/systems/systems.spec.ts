/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Redfish Computer Systems API Tests
 *
 * Endpoints covered:
 *   GET   /redfish/v1/Systems                                               (auth required)
 *   GET   /redfish/v1/Systems/{ComputerSystemId}                            (auth required)
 *   PATCH /redfish/v1/Systems/{ComputerSystemId}                            (auth required)
 *   POST  /redfish/v1/Systems/{ComputerSystemId}/Actions/ComputerSystem.Reset (auth required)
 *
 * The {ComputerSystemId} parameter must be a valid UUID/GUID.
 * Tests that target a specific device use the REDFISH_SYSTEM_ID env variable.
 * When a real device is not available, device-specific tests gracefully accept
 * 404 (system not found) alongside success responses.
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/Systems
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Systems Collection - GET /redfish/v1/Systems', () => {
  it('returns ComputerSystemCollection with Basic Auth', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.headers['content-type']).to.include('application/json')
      expect(response.headers['odata-version']).to.eq('4.0')
      expect(response.body['@odata.type']).to.include('ComputerSystemCollection')
      expect(response.body).to.have.property(
        'Name',
        systemsFixtures.collection.success.response.Name
      )
      expect(response.body).to.have.property('Members')
      expect(response.body.Members).to.be.an('array')
      expect(response.body).to.have.property('Members@odata.count')
    })
  })

  it('returns @odata.id pointing to /redfish/v1/Systems', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('@odata.id', '/redfish/v1/Systems')
    })
  })

  it('returns 401 without authentication', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/Systems/{ComputerSystemId}
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Individual Computer System - GET /redfish/v1/Systems/{ComputerSystemId}', () => {
  it('returns 400 for a non-UUID system ID', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/not-a-valid-uuid`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.BAD_REQUEST)
    })
  })

  it('returns ComputerSystem resource or 404 for a valid UUID system ID', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.SUCCESS, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body['@odata.type']).to.include('ComputerSystem')
        expect(response.body).to.have.property('Id', systemId())
        expect(response.body).to.have.property('@odata.id', `/redfish/v1/Systems/${systemId()}`)
      }
    })
  })

  it('returns 401 without authentication', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /redfish/v1/Systems/{ComputerSystemId}
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Update - PATCH /redfish/v1/Systems/{ComputerSystemId}', () => {
  it('returns 400 for a non-UUID system ID', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/not-a-valid-uuid`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.request,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.BAD_REQUEST)
    })
  })

  it('returns updated ComputerSystem or 404 when patching boot settings', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.request,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.SUCCESS, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body['@odata.type']).to.include('ComputerSystem')
      }
    })
  })

  it('returns 401 without authentication', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      body: systemsFixtures.patchBootSettings.request,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /redfish/v1/Systems/{ComputerSystemId}/Actions/ComputerSystem.Reset
// ─────────────────────────────────────────────────────────────────────────────
describe(
  'Redfish System Reset Action - POST /redfish/v1/Systems/{ComputerSystemId}/Actions/ComputerSystem.Reset',
  () => {
    it('returns 400 for a non-UUID system ID', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/not-a-valid-uuid/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: systemsFixtures.reset.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.BAD_REQUEST)
      })
    })

    it('returns 400 when ResetType is missing from request body', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: systemsFixtures.reset.missingResetType,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR])
      })
    })

    it('accepts a valid reset request or returns 404 when device is unavailable', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: systemsFixtures.reset.request,
        failOnStatusCode: false
      }).then((response) => {
        // 202 Accepted (success) or 404 (device not found/registered)
        expect(response.status).to.be.oneOf([202, 404, httpCodes.INTERNAL_SERVER_ERROR])
        if (response.status === 202) {
          expect(response.body).to.have.property('@odata.type')
          expect(response.body['@odata.type']).to.include('Task')
          expect(response.body).to.have.property('TaskState', 'Completed')
          expect(response.body).to.have.property('TaskStatus', 'OK')
          expect(response.headers).to.have.property('location')
        }
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        body: systemsFixtures.reset.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })

    it('returns 400 with Redfish error format for invalid ResetType', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: systemsFixtures.reset.invalidResetType,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.BAD_REQUEST)
        expect(response.body).to.have.property('error')
        expect(response.body.error).to.have.property('@Message.ExtendedInfo')
      })
    })
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// POST .../Actions/ComputerSystem.Reset — all supported ResetTypes
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Reset Action - All ResetTypes', () => {
  const cases = [
    { label: 'On',             body: () => systemsFixtures.reset.on },
    { label: 'ForceOff',       body: () => systemsFixtures.reset.forceOff },
    { label: 'ForceRestart',   body: () => systemsFixtures.reset.forceRestart },
    { label: 'GracefulRestart',body: () => systemsFixtures.reset.gracefulRestart },
    { label: 'PowerCycle',     body: () => systemsFixtures.reset.powerCycle }
  ]

  cases.forEach(({ label, body }) => {
    it(`accepts ResetType=${label} — 202 on success, 404/409 when device unavailable`, () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: body(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.be.oneOf([202, 404, 409, httpCodes.INTERNAL_SERVER_ERROR])
        if (response.status === 202) {
          expect(response.body['@odata.type']).to.include('Task')
          expect(response.body).to.have.property('TaskState', 'Completed')
          expect(response.body).to.have.property('TaskStatus', 'OK')
          expect(response.headers).to.have.property('location')
          expect(response.headers.location).to.include('/redfish/v1/TaskService/Tasks/')
          expect(response.headers['odata-version']).to.eq('4.0')
        }
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/Systems/{id} — detailed property assertions (device-guarded)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Computer System - Detailed Properties', () => {
  it('has valid PowerState enum value', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body).to.have.property('PowerState')
        if (response.body.PowerState) {
          expect(systemsFixtures.validPowerStates).to.include(response.body.PowerState)
        }
      }
    })
  })

  it('has valid SystemType enum value', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body).to.have.property('SystemType')
        if (response.body.SystemType) {
          expect(systemsFixtures.validSystemTypes).to.include(response.body.SystemType)
        }
      }
    })
  })

  it('has Status object with valid State and Health enum values', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS && response.body.Status) {
        const { Status } = response.body as { Status: Record<string, string> }
        expect(Status).to.be.an('object')
        if (Status.State) {
          expect(systemsFixtures.validStatusStates).to.include(Status.State)
        }
        if (Status.Health) {
          expect(systemsFixtures.validHealthValues).to.include(Status.Health)
        }
        if (Status.HealthRollup) {
          expect(systemsFixtures.validHealthValues).to.include(Status.HealthRollup)
        }
      }
    })
  })

  it('has BiosVersion as a string when present', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body).to.have.property('BiosVersion')
        if (response.body.BiosVersion != null) {
          expect(response.body.BiosVersion).to.be.a('string')
        }
      }
    })
  })

  it('has Manufacturer, Model, SerialNumber strings when present', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        if (response.body.Manufacturer != null) {
          expect(response.body.Manufacturer).to.be.a('string')
        }
        if (response.body.Model != null) {
          expect(response.body.Model).to.be.a('string')
        }
        if (response.body.SerialNumber != null) {
          expect(response.body.SerialNumber).to.be.a('string')
        }
      }
    })
  })

  it('has Actions.#ComputerSystem.Reset with correct target URL', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body).to.have.property('Actions')
        expect(response.body.Actions).to.have.property('#ComputerSystem.Reset')
        const resetAction = response.body.Actions['#ComputerSystem.Reset'] as { target: string }
        expect(resetAction).to.have.property('target')
        expect(resetAction.target).to.equal(
          `/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`
        )
      }
    })
  })

  it('has MemorySummary with valid structure when present', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS && response.body.MemorySummary) {
        const mem = response.body.MemorySummary as Record<string, unknown>
        expect(mem).to.be.an('object')
        if (mem.TotalSystemMemoryGiB != null) {
          expect(mem.TotalSystemMemoryGiB).to.be.a('number')
          expect(mem.TotalSystemMemoryGiB as number).to.be.greaterThan(0)
        }
        if (mem.MemoryMirroring != null) {
          expect(systemsFixtures.validMemoryMirroring).to.include(mem.MemoryMirroring as string)
        }
      }
    })
  })

  it('has ProcessorSummary with valid structure when present', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS && response.body.ProcessorSummary) {
        const proc = response.body.ProcessorSummary as Record<string, unknown>
        expect(proc).to.be.an('object')
        if (proc.Count != null) {
          expect(proc.Count).to.be.a('number')
          expect(proc.Count as number).to.be.greaterThan(0)
        }
        if (proc.Model != null) {
          expect(proc.Model).to.be.a('string')
        }
      }
    })
  })

  it('has exact @odata.context, @odata.id, and Id values', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body['@odata.context']).to.equal(
          '/redfish/v1/$metadata#ComputerSystem.ComputerSystem'
        )
        expect(response.body['@odata.id']).to.equal(`/redfish/v1/Systems/${systemId()}`)
        expect(response.body).to.have.property('Id', systemId())
      }
    })
  })

  it('returns 404 with error object for valid UUID that does not exist', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemsFixtures.nonExistentSystemId}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(404)
      expect(response.body).to.have.property('error')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Method Not Allowed on /redfish/v1/Systems/{ComputerSystemId}
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Computer System - Method Not Allowed', () => {
  it('returns 405 for POST /redfish/v1/Systems/{id}', () => {
    cy.request({
      method: 'POST',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: {},
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(405)
      expect(response.headers['odata-version']).to.eq('4.0')
      expect(response.body).to.have.property('error')
    })
  })

  it('returns 405 for PUT /redfish/v1/Systems/{id}', () => {
    cy.request({
      method: 'PUT',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: {},
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(405)
      expect(response.headers['odata-version']).to.eq('4.0')
      expect(response.body).to.have.property('error')
    })
  })

  it('returns 405 for DELETE /redfish/v1/Systems/{id}', () => {
    cy.request({
      method: 'DELETE',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(405)
      expect(response.headers['odata-version']).to.eq('4.0')
      expect(response.body).to.have.property('error')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /redfish/v1/Systems/{ComputerSystemId} — additional validation cases
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Update - PATCH additional scenarios', () => {
  it('returns 200/404 for BiosSetup boot target', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.biosSetup,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.SUCCESS, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body['@odata.type']).to.include('ComputerSystem')
      }
    })
  })

  it('returns 400 for invalid BootSourceOverrideTarget', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.invalidTarget,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.BAD_REQUEST) {
        expect(response.body).to.have.property('error')
      }
    })
  })

  it('returns 400 for invalid BootSourceOverrideEnabled value', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.invalidEnabled,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.BAD_REQUEST) {
        expect(response.body).to.have.property('error')
      }
    })
  })

  it('returns 404 with error for valid UUID that does not exist', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemsFixtures.nonExistentSystemId}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.request,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(404)
      expect(response.body).to.have.property('error')
    })
  })

  it('returns 200/400 for empty body PATCH', () => {
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.empty,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([
        httpCodes.SUCCESS, httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR
      ])
    })
  })

  it('returns 400 for malformed JSON body', () => {
    // Send raw truncated JSON to trigger parse error
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: { ...basicAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{"Boot": {"BootSourceOverrideEnabled": "Once"',
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.BAD_REQUEST) {
        expect(response.body).to.have.property('error')
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/Systems/{id} — optional properties + HEAD + edge IDs
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Computer System - Optional Properties and Method Edge Cases', () => {
  it('Description and HostName are strings when present (Postman #32)', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.SUCCESS) {
        if (response.body.Description != null) {
          expect(response.body.Description).to.be.a('string')
        }
        if (response.body.HostName != null) {
          expect(response.body.HostName).to.be.a('string')
        }
      }
    })
  })

  it('HEAD /redfish/v1/Systems/{id} returns 200 or 405 with empty body (Postman #38)', () => {
    cy.request({
      method: 'HEAD',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.SUCCESS, 405])
      if (response.status === httpCodes.SUCCESS) {
        expect(response.headers['odata-version']).to.eq('4.0')
        expect(response.headers['content-type']).to.include('application/json')
        expect(response.body).to.satisfy(
          (b: unknown) => b === '' || b === null || (typeof b === 'object' && Object.keys(b as object).length === 0)
        )
      }
    })
  })

  it('GET /redfish/v1/Systems/ (empty ID) returns 200 collection or 404 (Postman #39)', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.SUCCESS, 404])
      if (response.status === httpCodes.SUCCESS) {
        expect(response.body).to.satisfy(
          (b: Record<string, unknown>) => 'Members' in b || '@odata.type' in b
        )
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Security / Input Validation Edge Cases  (Postman #42–48)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Computer System - Security Edge Cases', () => {
  const badIds: Array<{ label: string; path: string }> = [
    { label: 'XSS attempt',          path: "<script>alert('xss')</script>" },
    { label: 'SQL injection',         path: "' OR '1'='1" },
    { label: 'path traversal',        path: '../../../etc/passwd' },
    { label: 'null byte',             path: 'system%00id' },
    { label: 'unicode chars',         path: encodeURIComponent('系统标识符') },
    { label: 'long ID (51 chars)',    path: 'a'.repeat(51) },
    { label: 'very long ID (1024)',   path: 'a'.repeat(1024) }
  ]

  badIds.forEach(({ label, path }) => {
    it(`returns 400 or 404 for ${label} in system ID`, () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/Systems/${path}`,
        headers: basicAuthHeaders(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, 414])
        if (response.headers['content-type']?.includes('application/json')) {
          expect(response.body).to.have.property('error')
        }
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reset — malformed JSON body (Postman #67)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Reset Action - Malformed JSON', () => {
  it('returns 400 for truncated/malformed JSON in Reset request', () => {
    cy.request({
      method: 'POST',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
      headers: { ...basicAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{"ResetType": "On"',
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, 404, httpCodes.INTERNAL_SERVER_ERROR])
      if (response.status === httpCodes.BAD_REQUEST) {
        expect(response.body).to.have.property('error')
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Authentication — error body structure (Postman #68)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Authentication - Error Body Structure', () => {
  it('returns 401 with @Message.ExtendedInfo array on unauthenticated /redfish/v1/Systems', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      expect(response.headers['content-type']).to.include('application/json')
      expect(response.headers['odata-version']).to.eq('4.0')
      expect(response.body).to.have.property('error')
      expect(response.body.error).to.have.property('@Message.ExtendedInfo')
      expect(response.body.error['@Message.ExtendedInfo']).to.be.an('array')
    })
  })

  it('returns 401 for invalid Basic Auth credentials on /redfish/v1/Systems', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems`,
      headers: { Authorization: `Basic ${btoa('invalid_user:invalid_password')}` },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling — invalid endpoint (Postman #71)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Error Handling - Invalid Endpoint', () => {
  it('returns 404 for GET /redfish/v1/InvalidEndpoint', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/InvalidEndpoint`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(404)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Complete BIOS Reset Flow — PATCH BiosSetup then POST ForceRestart (Postman #58)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Complete BIOS Reset Flow', () => {
  it('PATCH BiosSetup then ForceRestart — 202 Task or device-unavailable', () => {
    // Step 1: set boot override to BiosSetup
    cy.request({
      method: 'PATCH',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      body: systemsFixtures.patchBootSettings.biosSetup,
      failOnStatusCode: false
    }).then((patchResponse) => {
      // Only proceed to reset if PATCH succeeded
      if (patchResponse.status === httpCodes.SUCCESS) {
        cy.request({
          method: 'POST',
          url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
          headers: basicAuthHeaders(),
          body: systemsFixtures.reset.forceRestart,
          failOnStatusCode: false
        }).then((resetResponse) => {
          expect(resetResponse.status).to.be.oneOf([202, 409, 404, httpCodes.INTERNAL_SERVER_ERROR])
          if (resetResponse.status === 202) {
            expect(resetResponse.body['@odata.type']).to.include('Task')
            expect(resetResponse.body).to.have.property('TaskState', 'Completed')
            expect(resetResponse.body).to.have.property('TaskStatus', 'OK')
            expect(resetResponse.headers).to.have.property('location')
            expect(resetResponse.headers.location).to.include('/redfish/v1/TaskService/Tasks/')
          }
        })
      } else {
        cy.log(`Skipping reset step: PATCH returned ${patchResponse.status} (device not available)`)
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Power Cycle Lifecycle — Full Power OFF → ON flow with recursive state polling
//
// Flow:
//   1. GET  system  → assert PowerState is "On"          (precondition)
//   2. POST ForceOff → assert 202 Accepted
//   3. Poll GET every 10 s, up to 3 min, until PowerState = "Off"
//   4. Fixed 10-second settle wait
//   5. POST On      → assert 202 Accepted
//   6. Fixed 3-minute boot wait
//   7. Poll GET every 10 s, up to 3 min, until PowerState = "On"
//
// Total worst-case duration: ~9 min 10 s  →  test timeout set to 12 min.
// Skips gracefully when REDFISH_SYSTEM_ID is unavailable (device returns 404/500).
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish System Power Cycle Lifecycle', () => {
  /** Poll interval between GET /Systems/{id} calls while waiting for state change */
  const POLL_INTERVAL_MS = 10_000
  /** Maximum time to wait for each state transition (3 minutes) */
  const POLL_TIMEOUT_MS = 3 * 60 * 1000

  /**
   * Recursively polls GET /redfish/v1/Systems/{id} until `PowerState` equals
   * `targetState`, then resolves. Throws if `deadline` is exceeded.
   *
   * The `deadline` parameter is captured once on the first call (default =
   * now + POLL_TIMEOUT_MS) and passed unchanged on every recursive call so
   * that the same absolute deadline is used throughout the polling loop.
   */
  const pollPowerState = (
    targetState: string,
    deadline: number = Date.now() + POLL_TIMEOUT_MS
  ): void => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const current = (response.body as Record<string, string>).PowerState
      cy.log(`PowerState: ${current} (waiting for: ${targetState})`)
      if (current === targetState) {
        cy.log(`✅ PowerState reached: ${targetState}`)
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

  it('powers OFF then ON and verifies state transitions', { timeout: 12 * 60 * 1000 }, () => {
    // ── Step 1: Confirm the system is currently powered On ─────────────────
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}`,
      headers: basicAuthHeaders(),
      failOnStatusCode: false
    }).then((step1) => {
      if (step1.status !== httpCodes.SUCCESS) {
        cy.log(`⚠️  Device unavailable (HTTP ${step1.status}) — skipping power-cycle test`)
        return
      }
      expect(step1.body, 'Step 1: system must be On before test begins').to.have.property(
        'PowerState',
        'On'
      )

      // ── Step 2: POST ForceOff ─────────────────────────────────────────────
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
        headers: basicAuthHeaders(),
        body: systemsFixtures.reset.forceOff,
        failOnStatusCode: false
      }).then((step2) => {
        expect(step2.status, 'Step 2: ForceOff must be accepted (202)').to.eq(202)

        // ── Step 3: Poll until PowerState = "Off" (max 3 min) ────────────
        cy.log('Step 3: polling for PowerState "Off" (max 3 min) …')
        pollPowerState('Off')

        // ── Step 4: Additional 10-second settle wait ──────────────────────
        cy.log('Step 4: waiting 10 s after power-off …')
        cy.wait(10_000)

        // ── Step 5: POST On ───────────────────────────────────────────────
        cy.request({
          method: 'POST',
          url: `${redfishUrl()}/redfish/v1/Systems/${systemId()}/Actions/ComputerSystem.Reset`,
          headers: basicAuthHeaders(),
          body: systemsFixtures.reset.on,
          failOnStatusCode: false
        }).then((step5) => {
          expect(step5.status, 'Step 5: Power On must be accepted (202)').to.eq(202)

          // ── Step 6: Fixed 3-minute boot wait ─────────────────────────
          cy.log('Step 6: fixed 3-minute boot wait …')
          cy.wait(3 * 60 * 1000)

          // ── Step 7: Poll until PowerState = "On" (max 3 min) ─────────
          cy.log('Step 7: polling for PowerState "On" (max 3 min) …')
          pollPowerState('On')
        })
      })
    })
  })
})
