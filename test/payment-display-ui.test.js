const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('display button reflects role, selection and pending state; storage sends customerId only', async t => {
    const storageUrl = moduleUrl(fs.readFileSync(path.join(__dirname, '../js/modules/storage.js'), 'utf8'));
    const { storage } = await import(storageUrl);
    const ui = await import(moduleUrl(fs.readFileSync(path.join(__dirname, '../js/modules/ui.js'), 'utf8')
        .replace("'./storage.js'", JSON.stringify(storageUrl))));
    const elements = new Map();
    const previousDocument = global.document;
    const previousFetch = global.fetch;
    t.after(() => { global.document = previousDocument; global.fetch = previousFetch; });
    global.document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { dataset: {}, innerHTML: '', querySelectorAll: () => [] });
        return elements.get(id);
    } };
    ui.initElements();
    const button = global.document.getElementById('display-payment-btn');
    const customer = { id: 'one', name: 'Kunde', balance: 175, archived: false };
    storage.user = { role: 'staff' };
    for (const selection of [null, { ...customer, archived: true }, { ...customer, balance: 0 },
        { ...customer, balance: -1 }, { ...customer, balance: 1.5 }, { ...customer, balance: Number.MAX_SAFE_INTEGER + 1 }]) {
        ui.renderActiveCustomer(selection);
        assert.equal(button.disabled, true);
    }
    for (const role of ['staff', 'admin']) {
        storage.user = { role };
        ui.renderActiveCustomer(customer);
        assert.equal(button.disabled, false);
    }
    button.dataset.pending = 'true';
    ui.renderActiveCustomer({ ...customer, id: 'two' });
    assert.equal(button.disabled, true, 'switching selection or refreshing must not unlock pending request');
    delete button.dataset.pending;
    storage.user = { role: 'viewer' };
    ui.renderActiveCustomer(customer);
    assert.equal(button.disabled, true);
    const expected = { accepted: true, requestId: 'request', expiresAt: Date.now() + 30000 };
    global.fetch = async (url, options) => {
        assert.equal(url, '/api/display/payment');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { customerId: 'one' });
        return { ok: true, status: 200, json: async () => expected };
    };
    assert.deepEqual(await storage.displayPayment('one'), expected);
});

test('display handler blocks duplicate requests, reports acceptance accurately and restores latest selection', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    const handlerSource = source.slice(source.indexOf('async function handleDisplayPayment()'), source.indexOf('// Show History'));
    const button = { disabled: false, dataset: {}, setAttribute() {}, removeAttribute() {} };
    let selected = 'one';
    let resolveRequest;
    let rejectRequest;
    let calls = 0;
    const customers = { one: { id: 'one', balance: 175 }, two: { id: 'two', balance: 0 } };
    const messages = [];
    const storage = { getCustomer: id => customers[id], displayPayment: () => {
        calls++;
        return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
    } };
    const handler = new Function('document', 'storage', 'getActiveCustomerId', 'setButtonLoading', 'showToast', 'renderActiveCustomer',
        `${handlerSource}; return handleDisplayPayment;`)(
        { getElementById: () => button }, storage, () => selected,
        (b, on) => { b.disabled = on; }, (message, type) => messages.push({ message, type }),
        c => { button.disabled = !c || c.balance <= 0; });
    const pending = handler();
    assert.equal(button.disabled, true);
    await handler();
    assert.equal(calls, 1);
    selected = 'two';
    resolveRequest({ accepted: true });
    await pending;
    assert.equal(button.disabled, true);
    assert.equal(button.dataset.pending, undefined);
    assert.equal(messages[0].type, 'success');
    assert.match(messages[0].message, /mottakeren godtok/);
    assert.match(messages[0].message, /Ingen betaling er registrert/);
    selected = 'one';
    button.disabled = false;
    const failed = handler();
    rejectRequest(new Error('Receiver unavailable'));
    await failed;
    assert.equal(messages[1].type, 'error');
    assert.equal(messages[1].message, 'Receiver unavailable');
    assert.equal(button.disabled, false);
});
