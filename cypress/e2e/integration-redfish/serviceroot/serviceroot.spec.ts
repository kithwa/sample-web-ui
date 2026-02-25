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
      // @odata.context must reference $metadata and ServiceRoot (Postman #3)
      expect(response.body['@odata.context']).to.include('$metadata')
      expect(response.body['@odata.context']).to.include('ServiceRoot')
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

  it('each service entry has name, kind and url properties with valid enum kind', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      response.body.value.forEach((entry: { name: string; kind: string; url: string }) => {
        expect(entry).to.have.property('name')
        expect(entry.name).to.be.a('string').and.not.be.empty
        expect(entry).to.have.property('kind')
        expect(['Singleton', 'EntitySet']).to.include(entry.kind)
        expect(entry).to.have.property('url')
        expect(entry.url).to.include('/redfish/v1/')
        expect(entry.url).to.not.include('$metadata')
        expect(entry.url).to.not.include('/odata')
      })
    })
  })

  it('service entries are sorted alphabetically by name', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const names = (response.body.value as Array<{ name: string }>).map((e) => e.name)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      expect(names).to.deep.equal(sorted)
    })
  })

  it('lists Systems as a Singleton service at /redfish/v1/Systems', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/odata`,
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const systemsEntry = (response.body.value as Array<{ name: string; kind: string; url: string }>)
        .find((e) => e.name === 'Systems')
      expect(systemsEntry).to.exist
      expect(systemsEntry?.kind).to.equal('Singleton')
      expect(systemsEntry?.url).to.equal('/redfish/v1/Systems')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1  (no trailing slash)
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Service Root - No Trailing Slash', () => {
  it('GET /redfish/v1 returns 200 or redirect', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1`,
      failOnStatusCode: false,
      followRedirect: false
    }).then((response) => {
      expect(response.status).to.be.oneOf([200, 301, 302, 307, 308])
      if (response.status === 200) {
        expect(response.body).to.have.property('@odata.id')
      }
      if ([301, 302, 307, 308].includes(response.status)) {
        expect(response.headers['location']).to.include('/redfish/v1/')
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /redfish/v1/$metadata — XML content assertions
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish OData Metadata - XML Content', () => {
  it('response body is not empty', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      expect(response.body).to.be.a('string').and.have.length.greaterThan(0)
    })
  })

  it('contains required XML declaration and EDMX root element', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const xml = response.body as string
      expect(xml).to.include('<?xml version')
      expect(xml).to.include('<edmx:Edmx')
      expect(xml).to.include('http://docs.oasis-open.org/odata/ns/edmx')
    })
  })

  it('contains required DMTF Redfish namespace references', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const xml = response.body as string
      expect(xml).to.include('ServiceRoot')
      expect(xml).to.include('ComputerSystem')
      expect(xml).to.include('Resource')
    })
  })

  it('contains EDMX structural elements', () => {
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      const xml = response.body as string
      expect(xml).to.include('edmx:Reference')
      expect(xml).to.include('edmx:DataServices')
    })
  })

  it('returns identical response on second request (consistency)', () => {
    let firstBody: string
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.status).to.eq(httpCodes.SUCCESS)
      firstBody = response.body as string
    })
    cy.request({
      method: 'GET',
      url: `${redfishUrl()}/redfish/v1/$metadata`,
      failOnStatusCode: false,
      headers: { Accept: 'application/xml' }
    }).then((response) => {
      expect(response.body).to.equal(firstBody)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Method Not Allowed — /redfish/v1/  and  /redfish/v1/odata
// ─────────────────────────────────────────────────────────────────────────────
describe('Redfish Service Root - Method Not Allowed', () => {
  const methodsNotAllowed = ['POST', 'PUT', 'DELETE', 'PATCH'] as const

  methodsNotAllowed.forEach((method) => {
    it(`returns 405 for ${method} /redfish/v1/`, () => {
      cy.request({
        method,
        url: `${redfishUrl()}/redfish/v1/`,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? {} : undefined,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(405)
        expect(response.headers['odata-version']).to.not.be.undefined
        expect(response.body).to.have.property('error')
      })
    })
  })
})

describe('Redfish OData Service Document - Method Not Allowed', () => {
  const methodsNotAllowed = ['POST', 'PUT', 'DELETE', 'PATCH'] as const

  methodsNotAllowed.forEach((method) => {
    it(`returns 405 for ${method} /redfish/v1/odata`, () => {
      cy.request({
        method,
        url: `${redfishUrl()}/redfish/v1/odata`,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? {} : undefined,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(405)
        expect(response.headers['odata-version']).to.not.be.undefined
        expect(response.body).to.have.property('error')
      })
    })
  })
})
