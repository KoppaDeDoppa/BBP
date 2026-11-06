const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDatabase } = require('../server/database');
const { createUser } = require('../server/auth');
const { makeApi } = require('../server/api');

const db = openDatabase(':memory:');
const app = express();
app.use(express.json());
app.use('/api', makeApi(db));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
after(() => { server.close(); db.close(); });

async function request(path, { method = 'GET', body, cookie, origin } = {}) {
    await ready;
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api${path}`;
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (origin !== null) headers.origin = origin || `http://127.0.0.1:${address.port}`;
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
}

let adminCookie;
let staffCookie;

test('auth roles and atomic customer transactions', async t => {
    const admin = await createUser(db, { username: 'admin', password: 'test-password-admin', role: 'admin' });
    const staff = await createUser(db, { username: 'staff', password: 'test-password-staff' });

    await t.test('reject unauthenticated state and cross-origin writes', async () => {
        const denied = await request('/state');
        assert.equal(denied.response.status, 401);
        const rejected = await request('/customers', { method: 'POST', body: { name: 'Bad' }, origin: 'https://evil.example' });
        assert.equal(rejected.response.status, 403);
    });

    await t.test('login both roles and deny staff admin routes', async () => {
        const adminLogin = await request('/auth/login', { method: 'POST', body: { username: admin.username, password: 'test-password-admin' } });
        const staffLogin = await request('/auth/login', { method: 'POST', body: { username: staff.username, password: 'test-password-staff' } });
        assert.equal(adminLogin.response.status, 200);
        assert.equal(staffLogin.response.status, 200);
        adminCookie = adminLogin.response.headers.get('set-cookie').split(';')[0];
        staffCookie = staffLogin.response.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('/admin/users', { cookie: staffCookie })).response.status, 403);
        assert.equal((await request('/products', { method: 'POST', body: { name: 'Wine', price: 20, icon: '🍷' }, cookie: staffCookie })).response.status, 403);
    });

    await t.test('staff purchase, undo, settle, and sync state', async () => {
        const created = await request('/customers', { method: 'POST', body: { name: 'Testkunde' }, cookie: staffCookie });
        assert.equal(created.response.status, 201);
        const customerId = created.data.id;
        const purchase = await request('/transactions/purchase', { method: 'POST', body: { customerId, productId: 'beer' }, cookie: staffCookie });
        assert.equal(purchase.response.status, 201);
        let state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 50);
        const undo = await request(`/transactions/undo/${customerId}`, { method: 'POST', body: {}, cookie: staffCookie });
        assert.equal(undo.response.status, 200);
        state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 0);
        await request('/transactions/purchase', { method: 'POST', body: { customerId, productId: 'beer' }, cookie: staffCookie });
        const settled = await request(`/transactions/settle/${customerId}`, { method: 'POST', body: {}, cookie: staffCookie });
        assert.equal(settled.response.status, 201);
        state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 0);
        assert.equal(state.data.transactions.filter(tx => tx.customerId === customerId).length, 2);
    });
});
