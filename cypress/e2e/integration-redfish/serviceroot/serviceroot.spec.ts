/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Redfish Service Root, OData Metadata and OData Service Document API Tests
 *
 * Endpoints covered (all PUBLIC — no authentication required):
 *   GET /redfish/v1/             Service Root (JSON)
 *   GET /redfish/v1/$metadata    OData CSDL metadata document (XML)
 *   GET /redfish/v1/odata        OData service document (JSON)
 */

import { httpCodes } from 'cypress/e2e/fixtures/api/httpCodes'
import { servicerootFixtures } from 'cypress/e2e/fixtures/api/redfish/serviceroot'

const redfishUrl = (): string => Cypress.env('REDFISH_BASEURL') ?? 'http://localhost:8181'

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Service Root - GET /redfish/v1/', () => {
  it('is accessible without authentication', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
    })
  })

  it('responds with application/json and OData-Version: 4.0', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.headers['content-type']).to.include('application/json')
      expect(response.headers['odata-version']).to.eq('4.0')
    })
  })

  it('returns required @odata properties', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('@odata.context')
      expect(response.body).to.have.property('@odata.id')
      expect(response.body).to.have.property('@odata.type')
      expect(response.body['@odata.type']).to.include('ServiceRoot')
      expect(response.body['@odata.id']).to.be.oneOf(['/redfish/v1', '/redfish/v1/'])
    })
  })

  it('returns required Redfish ServiceRoot fields', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('Id', servicerootFixtures.serviceRoot.success.response.Id)
      expect(response.body).to.have.property('Name', servicerootFixtures.serviceRoot.success.response.Name)
      expect(response.body).to.have.property('RedfishVersion')
      expect(response.body.RedfishVersion).to.match(/^\d+\.\d+\.\d+$/)
      expect(response.body).to.have.property('UUID')
      expect(response.body.UUID).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })

  it('contains Systems link pointing to /redfish/v1/Systems', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('Systems')
      expect(response.body.Systems).to.have.property('@odata.id', '/redfish/v1/Systems')
    })
  })

  it('contains SessionService link pointing to /redfish/v1/SessionService', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('SessionService')
      expect(response.body.SessionService).to.have.property('@odata.id', '/redfish/v1/SessionService')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/$metadata
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish OData Metadata - GET /redfish/v1/$metadata', () => {
  it('is accessible without authentication', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
    })
  })

  it('responds with application/xml and OData-Version: 4.0', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.headers['content-type']).to.include('application/xml')
      expect(response.headers['odata-version']).to.eq('4.0')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/odata
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish OData Service Document - GET /redfish/v1/odata', () => {
  it('is accessible without authentication', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
    })
  })

  it('responds with application/json', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.headers['content-type']).to.include('application/json')
    })
  })

  it('contains @odata.context and a value array of service entries', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.have.property('@odata.context')
      expect(response.body).to.have.property('value')
      expect(response.body.value).to.be.an('array').and.have.length.gte(1)
    })
  })

  it('each service entry has name, kind and url properties', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      response.body.value.forEach((entry: { name: string; kind: string; url: string }) => {
        expect(entry).to.have.property('name')
        expect(entry).to.have.property('kind')
        expect(entry).to.have.property('url')
        expect(entry.url).to.include('/redfish/v1/')
      })
    })
  })
})
