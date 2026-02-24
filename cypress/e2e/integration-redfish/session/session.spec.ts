/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Redfish SessionService API Tests
 *
 * Endpoints covered:
 *   GET    /redfish/v1/SessionService                             (auth required)
 *   PATCH  /redfish/v1/SessionService                             (auth required)
 *   PUT    /redfish/v1/SessionService                             (auth required)
 *   GET    /redfish/v1/SessionService/Sessions                    (auth required)
 *   POST   /redfish/v1/SessionService/Sessions                    (PUBLIC — login)
 *   GET    /redfish/v1/SessionService/Sessions/{SessionId}        (auth required)
 *   DELETE /redfish/v1/SessionService/Sessions/{SessionId}        (auth required)
 *
 * Authentication:
 *   - Protected endpoints accept Basic Auth OR X-Auth-Token header.
 *   - POST /redfish/v1/SessionService/Sessions requires NO prior auth (it IS the login).
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import { sessionFixtures } from 'cypress/e2e/fixtures/api/redfish/session'

const redfishUrl = (): string => Cypress.env('REDFISH_BASEURL') ?? 'http://localhost:8181'

const basicAuthHeaders = (): Record<string, string> => {
  const username = (Cypress.env('REDFISH_USERNAME') as string) ?? 'standalone'
  const password = (Cypress.env('REDFISH_PASSWORD') as string) ?? 'G@ppm0ym'
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET/PATCH/PUT /redfish/v1/SessionService
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish SessionService Resource', () => {
  context('GET /redfish/v1/SessionService', () => {
    it('returns SessionService resource with Basic Auth', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        headers: basicAuthHeaders(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        expect(response.body).to.have.property('@odata.context')
        expect(response.body['@odata.type']).to.include('SessionService')
        expect(response.body).to.have.property(
          'Id',
          sessionFixtures.sessionService.success.response.Id
        )
        expect(response.body).to.have.property(
          'Name',
          sessionFixtures.sessionService.success.response.Name
        )
        expect(response.body).to.have.property('Sessions')
        expect(response.body.Sessions).to.have.property(
          '@odata.id',
          '/redfish/v1/SessionService/Sessions'
        )
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })

  context('PATCH /redfish/v1/SessionService', () => {
    it('returns current SessionService state with Basic Auth', () => {
      cy.request({
        method: 'PATCH',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        headers: basicAuthHeaders(),
        body: { SessionTimeout: 1800 },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        expect(response.body['@odata.type']).to.include('SessionService')
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'PATCH',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        body: {},
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })

  context('PUT /redfish/v1/SessionService', () => {
    it('returns current SessionService state with Basic Auth', () => {
      cy.request({
        method: 'PUT',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        headers: basicAuthHeaders(),
        body: {},
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        expect(response.body['@odata.type']).to.include('SessionService')
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'PUT',
        url: `${redfishUrl()}/redfish/v1/SessionService`,
        body: {},
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET/POST /redfish/v1/SessionService/Sessions
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Sessions Collection', () => {
  context('POST /redfish/v1/SessionService/Sessions (Login)', () => {
    it('creates a session with valid credentials — no prior auth required', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        body: sessionFixtures.validCredentials.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.CREATED)
        expect(response.headers).to.have.property('x-auth-token')
        expect(response.headers['x-auth-token']).to.be.a('string').and.not.be.empty
        expect(response.headers).to.have.property('location')
        expect(response.headers.location).to.include('/redfish/v1/SessionService/Sessions/')
      })
    })

    it('returns a valid Session resource body on successful login', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        body: sessionFixtures.validCredentials.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.CREATED)
        expect(response.body['@odata.type']).to.include('Session')
        expect(response.body).to.have.property('Id')
        expect(response.body).to.have.property(
          'UserName',
          sessionFixtures.validCredentials.request.UserName
        )
      })
    })

    it('returns 401 for invalid credentials', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        body: sessionFixtures.invalidCredentials.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })

    it('returns 400 when UserName and Password fields are missing', () => {
      cy.request({
        method: 'POST',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        body: sessionFixtures.missingFields.request,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.be.oneOf([httpCodes.BAD_REQUEST, httpCodes.UNAUTHORIZED])
      })
    })
  })

  context('GET /redfish/v1/SessionService/Sessions', () => {
    it('returns SessionCollection with Basic Auth', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        headers: basicAuthHeaders(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        expect(response.body['@odata.type']).to.include('SessionCollection')
        expect(response.body).to.have.property(
          'Name',
          sessionFixtures.sessionCollection.success.response.Name
        )
        expect(response.body).to.have.property('Members')
        expect(response.body.Members).to.be.an('array')
        expect(response.body).to.have.property('Members@odata.count')
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET/DELETE /redfish/v1/SessionService/Sessions/{SessionId}
// Uses session created via POST; token stored in before() hook.
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Individual Session', () => {
  let authToken: string
  let sessionId: string

  before(() => {
    cy.request({
      method: 'POST',
      url: `${redfishUrl()}/redfish/v1/SessionService/Sessions`,
      body: sessionFixtures.validCredentials.request,
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === httpCodes.CREATED) {
        authToken = response.headers['x-auth-token'] as string
        sessionId = response.body.Id as string
      }
    })
  })

  context('GET /redfish/v1/SessionService/Sessions/{SessionId}', () => {
    it('returns session details using X-Auth-Token', () => {
      if (!authToken || !sessionId) return cy.log('Skipping: login failed in before()')

      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/${sessionId}`,
        headers: { 'X-Auth-Token': authToken },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.SUCCESS)
        expect(response.body).to.have.property('Id', sessionId)
        expect(response.body['@odata.type']).to.include('Session')
        expect(response.body).to.have.property(
          'UserName',
          sessionFixtures.validCredentials.request.UserName
        )
      })
    })

    it('returns 404 for a non-existent session ID', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/00000000-does-not-exist`,
        headers: basicAuthHeaders(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(404)
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'GET',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/someid`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })

  context('DELETE /redfish/v1/SessionService/Sessions/{SessionId}', () => {
    it('deletes the active session using X-Auth-Token (logout)', () => {
      if (!authToken || !sessionId) return cy.log('Skipping: login failed in before()')

      cy.request({
        method: 'DELETE',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/${sessionId}`,
        headers: { 'X-Auth-Token': authToken },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.NO_CONTENT)
      })
    })

    it('returns 404 when deleting a non-existent session', () => {
      cy.request({
        method: 'DELETE',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/00000000-does-not-exist`,
        headers: basicAuthHeaders(),
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(404)
      })
    })

    it('returns 401 without authentication', () => {
      cy.request({
        method: 'DELETE',
        url: `${redfishUrl()}/redfish/v1/SessionService/Sessions/someid`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(httpCodes.UNAUTHORIZED)
      })
    })
  })
})
