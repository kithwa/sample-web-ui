/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * DMT Test Environment Version Fetcher
 *
 * Fetches component versions and hardware info before any test spec runs.
 * Called from cypress.config.ts setupNodeEvents `before:run` event.
 * Writes results to cypress/reports/.test-environment.json for consumption
 * by the custom HTML reporter.
 *
 * ── Backend service versions ────────────────────────────────────────────────
 *   Backend API URLs are read from the Angular environment source files — the same
 *   URLs the Angular app itself uses. No extra env vars needed.
 *   CLOUD=false → src/environments/environment.enterprise.dev.ts → mpsServer (Console)
 *   CLOUD=true  → src/environments/environment.ts → mpsServer (MPS), rpsServer (RPS)
 *   CLOUD=false (Console Enterprise):
 *     console       (1) CONSOLE_VERSION env var
 *                   (2) GET {mpsServer}/version → .current
 *   CLOUD=true (MPS + RPS):
 *     mps           (1) MPS_VERSION env var
 *                   (2) GET {mpsServer}/api/v1/version → .serviceVersion
 *     rps           (1) RPS_VERSION env var
 *                   (2) GET {rpsServer}/api/v1/admin/version → .serviceVersion
 *
 * ── Other software component versions ──────────────────────────────────────
 *   All taken solely from user-specified env vars in cypress.env.json.
 *   Report order and components follow the key order in cypress.env.json exactly.
 *   Deployment-scoped keys are automatically hidden for the wrong deployment:
 *     Console-only: CONSOLE_VERSION, GO_WSMAN_MESSAGES_VERSION (hidden when CLOUD=true)
 *     Cloud-only:   MPS_VERSION, RPS_VERSION, MPS_ROUTER_VERSION, WSMAN_MESSAGES_VERSION (hidden when CLOUD=false)
 *   Any other *_VERSION key is always reported regardless of deployment type.
 *   Set to "NOT_TO_DISPLAY" to hide a component from the report.
 *
 * ── AMT Firmware version ────────────────────────────────────────────────────
 *   Queried from Console or MPS devices API (deviceInfo.fwVersion).
 *   Only when ISOLATE=N. Uses CONSOLE_API_URL (Console) or MPS_API_URL (Cloud).
 *   Authentication: POST {API_URL}/api/v1/authorize { MPS_USERNAME, MPS_PASSWORD }.
 *   Device selection: matches DEVICE env var (IP), or first device found.
 */

'use strict'

const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')

/** Sentinel value: set any component version env var to this to hide it from the report. */
const HIDE_MARKER = 'NOT_TO_DISPLAY'

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

function fetchJSON(url, timeoutMs = 5000, headers = {}) {
  return new Promise((resolve) => {
    try {
      const protocol = url.startsWith('https:') ? https : http
      const req = protocol.get(url, { rejectUnauthorized: false, headers }, (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300
          try { resolve({ ok, data: JSON.parse(raw), statusCode: res.statusCode }) }
          catch { resolve({ ok: false, data: null, reason: 'invalid JSON response' }) }
        })
      })
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, data: null, reason: `timed out after ${timeoutMs}ms` }) })
      req.on('error', (err) => { resolve({ ok: false, data: null, reason: err.message }) })
    } catch (err) {
      resolve({ ok: false, data: null, reason: String(err) })
    }
  })
}

function postJSON(url, body, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const protocol = url.startsWith('https:') ? https : http
      const payload = JSON.stringify(body)
      const u = new URL(url)
      const options = {
        hostname: u.hostname,
        port: u.port || (url.startsWith('https:') ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        rejectUnauthorized: false
      }
      const req = protocol.request(options, (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300
          try { resolve({ ok, data: JSON.parse(raw), statusCode: res.statusCode }) }
          catch { resolve({ ok: false, data: null, reason: 'invalid JSON response' }) }
        })
      })
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, data: null, reason: `timed out after ${timeoutMs}ms` }) })
      req.on('error', (err) => { resolve({ ok: false, data: null, reason: err.message }) })
      req.write(payload)
      req.end()
    } catch (err) {
      resolve({ ok: false, data: null, reason: String(err) })
    }
  })
}

// ─── Angular Environment Reader ─────────────────────────────────────────────

/**
 * Reads backend server URLs from the Angular environment source files.
 * Eliminates the need for CONSOLE_API_URL / MPS_API_URL / RPS_API_URL env vars.
 *
 * CLOUD=false → environment.enterprise.dev.ts → mpsServer = Console API URL
 * CLOUD=true  → environment.ts               → mpsServer = MPS URL, rpsServer = RPS URL
 *
 * Falls back to localhost defaults if the file is missing or contains placeholders.
 * Also checks the BASEURL scheme: if BASEURL uses https, upgrades http→https on same host.
 */
function readAngularBackendUrls(isCloud, env) {
  const defaults = isCloud
    ? { mpsServer: 'http://localhost:3000', rpsServer: 'http://localhost:8081' }
    : { mpsServer: 'http://localhost:8181', rpsServer: 'http://localhost:8181' }
  let mpsServer, rpsServer
  try {
    const envFile = isCloud
      ? path.join(__dirname, '../../src/environments/environment.ts')
      : path.join(__dirname, '../../src/environments/environment.enterprise.dev.ts')
    const content = fs.readFileSync(envFile, 'utf8')
    const extract = (key) => {
      const m = content.match(new RegExp(key + '\\s*:\\s*[\'"`]([^\'"`]+)[\'"`]'))
      const val = m ? m[1] : null
      return (val && !val.includes('##')) ? val : null
    }
    mpsServer = extract('mpsServer') || defaults.mpsServer
    rpsServer = extract('rpsServer') || defaults.rpsServer
  } catch {
    mpsServer = defaults.mpsServer
    rpsServer = defaults.rpsServer
  }
  // If BASEURL uses https, upgrade http→https for backend URLs on the same hostname
  const baseUrl = (env && env.BASEURL) ? env.BASEURL : ''
  if (baseUrl.startsWith('https:')) {
    const upgradeScheme = (url) => url.startsWith('http://') ? 'https://' + url.slice(7) : url
    mpsServer = upgradeScheme(mpsServer)
    rpsServer = upgradeScheme(rpsServer)
  }
  return { mpsServer, rpsServer }
}

// ─── Misc Helpers ────────────────────────────────────────────────────────────

/**
 * Authenticates against the DMT API and returns a JWT token, or null on failure.
 */
async function loginForToken(baseUrl, username, password) {
  try {
    const r = await postJSON(`${baseUrl}/api/v1/authorize`, { username, password })
    return (r.ok && r.data && r.data.token) ? String(r.data.token) : null
  } catch { return null }
}

/**
 * Queries Console or MPS devices API for AMT firmware version (deviceInfo.fwVersion).
 * Matches DEVICE (IP) env var first; falls back to the first device that has fwVersion.
 * Returns { firmware: string|null, note: string }.
 */
async function fetchAmtFirmwareFromAPI(env, isCloud, apiUrl) {
  const username = env.MPS_USERNAME || ''
  const password = env.MPS_PASSWORD || ''
  if (!username || !password) {
    return { firmware: null, note: 'set MPS_USERNAME + MPS_PASSWORD env vars for API lookup' }
  }

  const baseUrl = apiUrl

  const token = await loginForToken(baseUrl, username, password)
  if (!token) return { firmware: null, note: `could not authenticate to ${isCloud ? 'MPS' : 'Console'} API` }

  // Both Console and MPS use GET /api/v1/devices
  const devicesUrl = `${baseUrl}/api/v1/devices?$top=100&$skip=0&$count=true`

  const r = await fetchJSON(devicesUrl, 8000, { Authorization: `Bearer ${token}` })
  if (!r.ok || !r.data) return { firmware: null, note: `could not fetch devices from ${isCloud ? 'MPS' : 'Console'} API` }

  // Response shape: { data: Device[], totalCount }
  const devices = Array.isArray(r.data)
    ? r.data
    : (Array.isArray(r.data.data) ? r.data.data : [])

  if (devices.length === 0) return { firmware: null, note: 'no devices found in API' }

  const targetIp = env.DEVICE || null
  let device = null
  let matchNote = ''

  if (isCloud) {
    // MPS: devices have deviceInfo.ipAddress + deviceInfo.fwVersion inline
    if (targetIp) {
      device = devices.find((d) => d.deviceInfo && d.deviceInfo.ipAddress === targetIp)
      if (device) matchNote = `device IP ${targetIp}`
    }
    if (!device) {
      device = devices.find((d) => d.deviceInfo && d.deviceInfo.fwVersion)
      if (device) matchNote = device.hostname || device.guid || 'first device'
    }
    if (device && device.deviceInfo && device.deviceInfo.fwVersion) {
      return {
        firmware: String(device.deviceInfo.fwVersion),
        note: `from MPS API (${matchNote})`
      }
    }
    return { firmware: null, note: 'no device with fwVersion found in MPS API' }
  } else {
    // Console: devices have hostname + guid; firmware requires a separate call
    if (targetIp) {
      device = devices.find((d) => d.hostname === targetIp)
      if (device) matchNote = `hostname ${targetIp}`
    }
    if (!device) {
      device = devices[0]
      matchNote = device.friendlyName || device.hostname || device.guid || 'first device'
    }
    if (!device || !device.guid) return { firmware: null, note: 'no device GUID available from Console API' }

    const amtVerUrl = `${baseUrl}/api/v1/amt/version/${device.guid}`
    const vr = await fetchJSON(amtVerUrl, 8000, { Authorization: `Bearer ${token}` })
    if (!vr.ok || !vr.data) return { firmware: null, note: `could not fetch AMT version for ${device.guid}` }

    const responses = vr.data.CIM_SoftwareIdentity && vr.data.CIM_SoftwareIdentity.responses
    const amtEntry = Array.isArray(responses) && responses.find((e) => e.InstanceID === 'AMT')
    if (amtEntry && amtEntry.VersionString) {
      return {
        firmware: String(amtEntry.VersionString),
        note: `from Console API (${matchNote})`
      }
    }
    return { firmware: null, note: 'AMT version entry not found in Console API response' }
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Fetches all relevant DMT component versions for the current test run.
 *
 * @param {Object} config  Cypress config object (from setupNodeEvents)
 * @returns {Promise<Object>} testEnvironment info object
 */
async function fetchVersionInfo(config) {
  const env = config.env || {}
  const isCloud = !!env.CLOUD
  const { mpsServer, rpsServer } = readAngularBackendUrls(isCloud)

  const result = {
    deploymentType: isCloud ? 'Cloud Deployment (MPS + RPS)' : 'Console Enterprise',
    isCloud,
    fetchedAt: new Date().toISOString(),
    components: []
  }

  /**
   * Appends a component entry.
   * If version === HIDE_MARKER the entry is skipped entirely (hidden from report).
   */
  const add = (name, version, note = '') => {
    if (version === HIDE_MARKER) return   // user opted to hide this component
    result.components.push({ name, version: version || 'N/A', note })
  }

  // ── Component versions: fully dynamic, order follows cypress.env.json ───────
  //
  // Every *_VERSION key in cypress.env.json is reported in the order it appears.
  // Add, remove, or reorder keys in cypress.env.json — the report mirrors it.
  //
  // Deployment-scoped keys are automatically skipped for the wrong deployment type:
  //   Console-only: CONSOLE_VERSION, GO_WSMAN_MESSAGES_VERSION
  //   Cloud-only:   MPS_VERSION, RPS_VERSION, MPS_ROUTER_VERSION, WSMAN_MESSAGES_VERSION
  //
  // Three keys support live API fetching when left empty:
  //   CONSOLE_VERSION  → GET ${mpsServer}/version
  //   MPS_VERSION      → GET ${mpsServer}/api/v1/version
  //   RPS_VERSION      → GET ${rpsServer}/api/v1/admin/version
  // All other *_VERSION keys are env-var-only (set NOT_TO_DISPLAY to hide).

  const consoleOnlyKeys = new Set(['CONSOLE_VERSION', 'GO_WSMAN_MESSAGES_VERSION'])
  const cloudOnlyKeys   = new Set(['MPS_VERSION', 'RPS_VERSION', 'MPS_ROUTER_VERSION', 'WSMAN_MESSAGES_VERSION'])

  const apiFetchers = {
    async CONSOLE_VERSION() {
      const url = `${mpsServer}/version`
      const r = await fetchJSON(url)
      // Console returns HTTP 500 when GitHub latest-release fetch fails (rate limit / network),
      // but the body always includes { current: "..." } — use it regardless of status code.
      const ver = (r.data && r.data.current) ? String(r.data.current) : null
      return {
        ver,
        note: ver ? '' : `unreachable: ${url} (${r.reason || (r.statusCode ? `HTTP ${r.statusCode}` : 'no response')})`
      }
    },
    async MPS_VERSION() {
      const url = `${mpsServer}/api/v1/version`
      const r = await fetchJSON(url)
      return {
        ver:  r.ok && r.data?.serviceVersion ? r.data.serviceVersion  : null,
        note: r.ok ? '' : `unreachable: ${url} (${r.reason || 'no response'})`
      }
    },
    async RPS_VERSION() {
      const url = `${rpsServer}/api/v1/admin/version`
      const r = await fetchJSON(url)
      return {
        ver:  r.ok && r.data?.serviceVersion ? r.data.serviceVersion  : null,
        note: r.ok
          ? (r.data?.protocolVersion ? `protocol: ${r.data.protocolVersion}` : '')
          : `unreachable: ${url} (${r.reason || 'no response'})`
      }
    }
  }

  for (const key of Object.keys(env)) {
    if (!key.endsWith('_VERSION')) continue
    if (consoleOnlyKeys.has(key) && isCloud)  continue   // console component — skip for cloud
    if (cloudOnlyKeys.has(key)   && !isCloud) continue   // cloud component   — skip for console
    const val = env[key]
    if (val === HIDE_MARKER) continue
    const name = key.replace(/_VERSION$/, '').toLowerCase().replace(/_/g, '-')
    if (val) {
      add(name, val, `from ${key} env var`)
    } else if (apiFetchers[key]) {
      const { ver, note } = await apiFetchers[key]()
      add(name, ver, note)
    } else {
      add(name, null, `set ${key} env var`)
    }
  }

  // ── AMT firmware: queried from Console / MPS devices API (non-isolated runs only) ───
  const isIsolated = String(env.ISOLATE || 'Y').charAt(0).toLowerCase() !== 'n'
  let amtFirmware = null
  let amtFirmwareNote = 'isolated run — set ISOLATE=N with a real AMT device to query firmware'
  if (!isIsolated) {
    const res = await fetchAmtFirmwareFromAPI(env, isCloud, mpsServer)
    amtFirmware = res.firmware
    amtFirmwareNote = res.note
  }

  result.infrastructure = {
    amtFirmware:     amtFirmware || null,
    amtFirmwareNote
  }

  return result
}

module.exports = { fetchVersionInfo, HIDE_MARKER }
