const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let server;
let baseUrl;
let token;
let dbPath;

test.before(async () => {
  dbPath = path.join(os.tmpdir(), `visionag-test-${Date.now()}.db`);
  process.env.JWT_SECRET = 'test-secret-123';
  process.env.VISIONAG_DB_PATH = dbPath;
  process.env.CORS_ORIGINS = 'http://127.0.0.1:3000';

  const { startServer } = require('../server');
  server = await startServer(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test('health endpoint returns ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('login works and returns JWT', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.token);
  token = body.token;
});

test('products endpoint requires auth', async () => {
  const res = await fetch(`${baseUrl}/api/products`);
  assert.equal(res.status, 401);
});

test('products endpoint works with auth', async () => {
  const res = await fetch(`${baseUrl}/api/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
});

test('invoice validation rejects empty items', async () => {
  const res = await fetch(`${baseUrl}/api/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      invoice_number: 'INV-TEST-0001',
      invoice_date: '2026-01-01',
      items: [],
    }),
  });
  assert.equal(res.status, 400);
});
