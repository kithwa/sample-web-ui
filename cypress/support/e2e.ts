/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

// Import commands.js using ES2015 syntax:
import './commands'

// ── Network logging (toggled by CYPRESS_LOG_NETWORK=true) ─────────────────────
// When enabled, every cy.intercept() call is recorded with method, URL, status
// code, request body and response body.  Logs are collected in a browser-side
// array and flushed to the Node process via a single cy.task() in afterEach,
// which writes them to a temp JSON file the custom reporter reads at run end.
//
// How to enable:
//   npx cypress run --env LOG_NETWORK=true ...
//   or set LOG_NETWORK: 'true' in cypress.config.ts env block

if (Cypress.env('LOG_NETWORK') === 'true' || Cypress.env('LOG_NETWORK') === true) {
  // Browser-side log buffer — reset each test
  let currentTestLogs: {
    method: string
    url: string
    statusCode: number
    requestBody: unknown
    responseBody: unknown
    duration: number
    timestamp: string
  }[] = []

  beforeEach(() => {
    currentTestLogs = []

    // Register a catch-all intercept. We collect data synchronously inside the
    // response callback (no cy.task here) and flush the whole array in afterEach.
    cy.intercept({ url: '**' }, (req) => {
      const startTime = Date.now()
      const method = req.method
      const url = req.url
      const requestBody = req.body ?? null
      const timestamp = new Date().toISOString()

      req.continue((res) => {
        currentTestLogs.push({
          method,
          url,
          statusCode: res.statusCode,
          requestBody,
          responseBody: res.body ?? null,
          duration: Date.now() - startTime,
          timestamp
        })
      })
    }).as('__networkLogger')
  })

  // Flush the collected log entries to Node in a single task call after each test.
  afterEach(() => {
    // Use space join to match Mocha's test.fullTitle() format used as the key in the reporter
    const testTitle = Cypress.currentTest.titlePath.join(' ')
    const logs = [...currentTestLogs]
    cy.task('networkLogFlush', { testTitle, logs })
  })
}

