/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Cypress configuration for DMTF Redfish API tests only.
 *
 * Run with:
 *   npx cypress run --config-file cypress.redfish.config.ts
 *   npm run cy-runner:redfish
 *   npm run cy-open:redfish
 *
 * These tests use cy.request() to call the Redfish API directly —
 * no Angular UI is required to be running.
 *
 * Environment variables (override via CLI --env or .env file):
 *   REDFISH_BASEURL   Base URL of the Redfish server (default: http://localhost:8181)
 *   REDFISH_USERNAME  Admin username for Basic Auth  (default: standalone)
 *   REDFISH_PASSWORD  Admin password for Basic Auth  (default: G@ppm0ym)
 *   REDFISH_SYSTEM_ID UUID of a registered AMT device (optional; tests accept 404 if absent)
 */

import { defineConfig } from 'cypress'

export default defineConfig({
  reporter: 'junit',
  reporterOptions: {
    mochaFile: 'cypress-redfish-api-test-output-[hash].xml'
  },
  viewportWidth: 1280,
  viewportHeight: 720,
  projectId: 'mxeztq',

  env: {
    // Base URL of the Redfish server (matches Postman test environment port)
    REDFISH_BASEURL: 'https://localhost:8181',
    // Credentials for Basic Auth and POST /redfish/v1/SessionService/Sessions
    REDFISH_USERNAME: 'standalone',
    REDFISH_PASSWORD: 'G@ppm0ym',
    // Optional: a real registered AMT device UUID for Systems tests.
    // If not set, device-specific tests gracefully accept 404.
    REDFISH_SYSTEM_ID: '15ccd72c-46ac-4991-a8d1-ef2e89e3a453'
  },

  // API-only tests: no browser launch strictly needed, but Cypress still
  // requires a browser context. Tests run headlessly via electron.
  chromeWebSecurity: false,
  // Allow self-signed TLS certificates from the console backend
  rejectUnauthorized: false,

  e2e: {
    // Run specs under integration-redfish/ (alongside the original integration/ folder)
    specPattern: 'cypress/e2e/integration-redfish/**/*.spec.ts',
    supportFile: 'cypress/support/e2e.ts',
    screenshotOnRunFailure: false,
    // Longer timeouts for API calls that may hit real hardware
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 15000
  }
})
