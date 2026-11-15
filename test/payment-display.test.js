const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDatabase, getState } = require('../server/database');
const { createSession, SESSION_COOKIE } = require('../server/auth');
const { makeApi } = require('../server/api');

async function fixture(t) {
    const db = openDatabase(':memory:');
    const cookies = {};
    for (const role of ['admin', 'staff', 'viewer', 'inactive']) {
        db.pragma('ignore_check_constraints = ON');
        db.prepare('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(role, role, 'unused', role === 'inactive' ? 'staff' : role, role === 'inactive' ? 0 : 1, new Date().toISOString());
        cookies[role] = `${SESSION_COOKIE}=${createSession(db, role)}`;
        db.pragma('ignore_check_constraints = OFF');
    }
    db.prepare('INSERT INTO customers (id, name, balance, archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run('customer', 'Private name', 175, '2026-01-01', '2026-01-01');
    db.prepare(`INSERT INTO transactions (id, customer_id, type, product_id, product_name, amount, price, timestamp)
        VALUES ('purchase', 'customer', 'purchase', 'beer', 'Beer', 175, 175, '2026-01-01')`).run();
    const calls = [];
    const env = { TAP_DISPLAY_URL: 'http://tap-display:3005', PAYMENT_DISPLAY_SECRET: 's'.repeat(32) };
    let reply = async (_url, options) => {
        const body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ accepted: true, requestId: body.requestId, expiresAt: Date.now() + 30000 }) };
    };
    const app = express();
    app.use(express.json());
    app.use('/api', makeApi(db, { env, fetch: async (...args) => { calls.push(args); return reply(...args); } }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(() => { db.close(); resolve(); }); server.closeIdleConnections(); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function request({ body = { customerId: 'customer' }, role = 'staff', requestOrigin = origin } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (cookies[role]) headers.cookie = cookies[role];
        if (requestOrigin !== null) headers.origin = requestOrigin;
        const response = await fetch(`${origin}/api/display/payment`, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    const snapshot = () => getState(db, { role: 'admin' });
    return { db, env, calls, request, snapshot, setReply: fn => { reply = fn; } };
}

test('payment display requires same-origin authenticated active staff/admin', async t => {
    const f = await fixture(t);
    const before = f.snapshot();
    for (const role of ['none', 'inactive']) assert.equal((await f.request({ role })).status, 401);
    assert.equal((await f.request({ role: 'viewer' })).status, 403);
    for (const requestOrigin of [null, 'https://evil.example', 'http://tap-display:3005']) {
        assert.equal((await f.request({ requestOrigin })).status, 403);
    }
    assert.equal(f.calls.length, 0);
    for (const role of ['staff', 'admin']) assert.equal((await f.request({ role })).status, 200);
    assert.deepEqual(f.snapshot(), before);
});

test('payment display sends only authoritative whole NOK amount and exact receiver contract', async t => {
    const f = await fixture(t);
    const before = f.snapshot();
    const started = Date.now();
    const first = await f.request();
    assert.equal(first.status, 200);
    assert.equal(first.body.accepted, true);
    const [url, options] = f.calls[0];
    assert.equal(url, 'http://tap-display:3005/api/payment-display');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${f.env.PAYMENT_DISPLAY_SECRET}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    const payload = JSON.parse(options.body);
    assert.deepEqual(Object.keys(payload).sort(), ['amount', 'deadline', 'requestId']);
    assert.equal(payload.amount, 175);
    assert.match(payload.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(payload.deadline >= started + 5000 && payload.deadline <= Date.now() + 5000);
    assert.equal(first.body.requestId, payload.requestId);
    assert.deepEqual(f.snapshot(), before);
    f.db.prepare('UPDATE customers SET balance = 225 WHERE id = ?').run('customer');
    const second = await f.request();
    assert.equal(JSON.parse(f.calls[1][1].body).amount, 225);
    assert.notEqual(second.body.requestId, first.body.requestId);
});

test('payment display rejects unknown fields, forged amounts and invalid customer balances without writes', async t => {
    const f = await fixture(t);
    const before = f.snapshot();
    for (const body of [null, [], {}, { customerId: '' }, { customerId: 2 }, { customerId: 'missing' },
        { customerId: 'customer', amount: 1 }, { customerId: 'customer', url: 'http://evil.example' },
        { customerId: 'customer', requestId: 'forged' }, { customerId: 'customer', deadline: Date.now() }]) {
        assert.equal((await f.request({ body })).status, 400);
    }
    assert.deepEqual(f.snapshot(), before);
    for (const balance of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        f.db.prepare('UPDATE customers SET balance = ?').run(balance);
        const state = f.snapshot();
        assert.equal((await f.request()).status, 400);
        assert.deepEqual(f.snapshot(), state);
    }
    f.db.prepare('UPDATE customers SET balance = 175, archived = 1').run();
    assert.equal((await f.request()).status, 400);
    assert.equal(f.calls.length, 0);
});

test('payment display configuration is optional and rejects non-origin URLs and weak secrets', async t => {
    const f = await fixture(t);
    const before = f.snapshot();
    for (const url of [undefined, '', 'ftp://example.com', 'http://user:pass@example.com', 'http://example.com/path',
        'http://example.com?query', 'http://example.com#hash', 'http://example.com/../', '//example.com', ' http://example.com']) {
        f.env.TAP_DISPLAY_URL = url;
        const result = await f.request();
        assert.equal(result.status, 503);
        assert.ok(!JSON.stringify(result.body).includes('example.com'));
    }
    f.env.TAP_DISPLAY_URL = 'http://tap-display:3005';
    for (const secret of [undefined, '', 's'.repeat(31), 's'.repeat(32) + '\n']) {
        f.env.PAYMENT_DISPLAY_SECRET = secret;
        assert.equal((await f.request()).status, 503);
    }
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.snapshot(), before);
    f.env.PAYMENT_DISPLAY_SECRET = 's'.repeat(32);
    for (const url of ['https://display.example', 'http://10.0.0.33:3005/']) {
        f.env.TAP_DISPLAY_URL = url;
        assert.equal((await f.request()).status, 200);
    }
});

test('receiver rejection, timeout, redirect and invalid acknowledgements are controlled and never financial writes', async t => {
    const f = await fixture(t);
    const before = f.snapshot();
    const errors = [
        async () => ({ ok: false, status: 503 }),
        async () => ({ ok: false, status: 401 }),
        async () => ({ ok: false, status: 302 }),
        async () => { throw new DOMException('secret URL must not leak', 'TimeoutError'); },
        async () => { throw new Error('redirect or network error with secret URL'); },
        async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }),
        async () => ({ ok: true, json: async () => ({ accepted: false }) }),
        async () => ({ ok: true, json: async () => ({ accepted: true, requestId: 'wrong', expiresAt: Date.now() + 30000 }) }),
        async (_url, options) => ({ ok: true, json: async () => ({ accepted: true, requestId: JSON.parse(options.body).requestId, expiresAt: 1 }) })
    ];
    for (const reply of errors) {
        f.setReply(reply);
        const result = await f.request();
        assert.equal(result.status, 502);
        assert.ok(!JSON.stringify(result.body).includes('secret'));
        assert.deepEqual(f.snapshot(), before);
    }
    const signal = f.calls[0][1].signal;
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    assert.equal(signal.reason.name, 'TimeoutError');
});
