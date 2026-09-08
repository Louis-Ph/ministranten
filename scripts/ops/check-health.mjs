#!/usr/bin/env node
/** Read-only deployment checks. No credentials or response bodies are logged. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const CONFIG_URL = new URL('../../config/operations.json', import.meta.url);
const CONTENT_TYPES = Object.freeze({ html: 'text/html', json: 'application/json' });

class CheckFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function checkedUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) URL without credentials, query parameters or fragment.');
  }
  return url;
}

export async function loadOperationsConfig() {
  return JSON.parse(await readFile(CONFIG_URL, 'utf8'));
}

function validateConfig(config) {
  const request = config.monitoring.request;
  for (const field of ['timeoutMs', 'attempts', 'maxResponseBytes']) {
    if (!Number.isSafeInteger(request[field]) || request[field] <= 0) {
      throw new Error(`monitoring.request.${field} must be a positive integer.`);
    }
  }
  if (!Number.isSafeInteger(request.retryDelayMs) || request.retryDelayMs < 0) {
    throw new Error('monitoring.request.retryDelayMs must be a non-negative integer.');
  }
  const checks = Object.entries(config.monitoring.checks);
  if (!checks.length) throw new Error('At least one deployment check is required.');
  for (const [name, check] of checks) {
    if (!Object.hasOwn(CONTENT_TYPES, check.format) || !check.path?.startsWith('/') || check.path.startsWith('//')) {
      throw new Error(`Invalid check configuration: ${name}.`);
    }
    if (check.format === 'html' && (!Array.isArray(check.contains) || !check.contains.length || check.contains.some(marker => typeof marker !== 'string' || !marker))) {
      throw new Error(`HTML markers are required for ${name}.`);
    }
    if (check.format === 'json' && (!check.expected || Array.isArray(check.expected) || typeof check.expected !== 'object' || !Object.keys(check.expected).length)) {
      throw new Error(`JSON expectations are required for ${name}.`);
    }
  }
}

function verifyExpected(actual, expected, path = '') {
  for (const [key, value] of Object.entries(expected)) {
    const field = path ? `${path}.${key}` : key;
    if (!actual || typeof actual !== 'object' || Array.isArray(actual) || !Object.hasOwn(actual, key)) {
      throw new CheckFailure('contract', `Missing field: ${field}.`);
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      verifyExpected(actual[key], value, field);
    } else if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
      throw new CheckFailure('contract', `Unexpected value for ${field}.`);
    }
  }
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CheckFailure('body_size', 'Response exceeded the configured size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function requestCheck(url, check, request, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new CheckFailure('timeout', 'Request timed out.'));
      controller.abort();
    }, request.timeoutMs);
  });
  try {
    await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: CONTENT_TYPES[check.format], 'Cache-Control': 'no-cache' },
          redirect: 'error',
          signal: controller.signal
        });
        if (response.status !== 200) {
          throw new CheckFailure('http', `HTTP ${response.status}.`);
        }
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (contentType !== CONTENT_TYPES[check.format]) {
          throw new CheckFailure('content_type', `Expected ${CONTENT_TYPES[check.format]}.`);
        }
        const body = await readBoundedBody(response, request.maxResponseBytes);
        if (check.format === 'html') {
          if (!check.contains.every(marker => body.includes(marker))) {
            throw new CheckFailure('contract', 'Application HTML markers are missing.');
          }
        } else {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            throw new CheckFailure('json', 'Response is not valid JSON.');
          }
          verifyExpected(parsed, check.expected);
        }
      })(),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function runCheck(name, url, check, request, fetchImpl, sleep) {
  let lastFailure;
  for (let attempt = 1; attempt <= request.attempts; attempt += 1) {
    try {
      await requestCheck(url, check, request, fetchImpl);
      return { name, ok: true, attempts: attempt, code: 'ready', message: 'Ready.' };
    } catch (error) {
      lastFailure = error instanceof CheckFailure
        ? error
        : new CheckFailure('network', 'Request failed (network, TLS or redirect).');
      if (attempt < request.attempts) await sleep(request.retryDelayMs);
    }
  }
  return { name, ok: false, attempts: request.attempts, code: lastFailure.code, message: lastFailure.message };
}

/** APP_BASE_URL changes all checks; legacy HEALTH_URL overrides the DB endpoint. */
export async function checkDeployment(config, { env = process.env, fetchImpl = fetch, sleep = delay } = {}) {
  validateConfig(config);
  const healthUrl = env.HEALTH_URL ? checkedUrl(env.HEALTH_URL) : null;
  const baseUrl = checkedUrl(env.APP_BASE_URL || healthUrl?.origin || config.deployment.publicBaseUrl);
  const checks = await Promise.all(Object.entries(config.monitoring.checks).map(([name, check]) => {
    const url = name === 'database' && healthUrl ? healthUrl : checkedUrl(new URL(check.path, baseUrl));
    return runCheck(name, url, check, config.monitoring.request, fetchImpl, sleep);
  }));
  return { ok: checks.every(check => check.ok), checks };
}

export function formatReport(report) {
  return report.checks.map(check => `${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.message} (${check.attempts} attempt${check.attempts === 1 ? '' : 's'})`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await checkDeployment(await loadOperationsConfig());
    console.log(formatReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    console.error('FAIL monitoring: invalid configuration. Check config/operations.json and URL overrides.');
    process.exitCode = 1;
  }
}
