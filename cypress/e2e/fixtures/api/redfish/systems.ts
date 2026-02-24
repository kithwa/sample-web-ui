/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Fixtures for Redfish Computer Systems API tests.
 * Covers: GET  /redfish/v1/Systems
 *         GET  /redfish/v1/Systems/{ComputerSystemId}
 *         PATCH /redfish/v1/Systems/{ComputerSystemId}
 *         POST /redfish/v1/Systems/{ComputerSystemId}/Actions/ComputerSystem.Reset
 *
 * testSystemId matches the Postman test environment system_id value.
 * Override at runtime with the REDFISH_SYSTEM_ID Cypress environment variable.
 */

const TEST_SYSTEM_ID = '550e8400-e29b-41d4-a716-446655440001'

const systemsFixtures = {
  testSystemId: TEST_SYSTEM_ID,

  collection: {
    success: {
      response: {
        '@odata.context':
          '/redfish/v1/$metadata#ComputerSystemCollection.ComputerSystemCollection',
        '@odata.id': '/redfish/v1/Systems',
        '@odata.type': '#ComputerSystemCollection.ComputerSystemCollection',
        Name: 'Computer System Collection'
      }
    }
  },

  reset: {
    request: {
      ResetType: 'GracefulShutdown'
    },
    invalidResetType: {
      ResetType: 'NotARealResetType'
    },
    missingResetType: {}
  },

  patchBootSettings: {
    request: {
      Boot: {
        BootSourceOverrideEnabled: 'Once',
        BootSourceOverrideTarget: 'Pxe'
      }
    }
  }
}

export { systemsFixtures }
