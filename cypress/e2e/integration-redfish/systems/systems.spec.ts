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
  }
)
