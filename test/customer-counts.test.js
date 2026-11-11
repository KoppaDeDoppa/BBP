const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('customer list counts purchases by product and follows order changes', async () => {
    const storageUrl = moduleUrl(fs.readFileSync(path.join(__dirname, '../js/modules/storage.js'), 'utf8'));
    const { storage } = await import(storageUrl);
    const source = fs.readFileSync(path.join(__dirname, '../js/modules/ui.js'), 'utf8')
        .replace("'./storage.js'", JSON.stringify(storageUrl));
    const ui = await import(moduleUrl(source));
    const elements = new Map();
    const previousDocument = global.document;
    global.document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, { innerHTML: '', querySelectorAll: () => [] });
            return elements.get(id);
        },
        createElement() {
            return { textContent: '', get innerHTML() {
                return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } };
        }
    };
    try {
        ui.initElements();
        const customers = [{ id: 'one', name: 'Kunde', balance: 200 }, { id: 'two', name: 'Andre', balance: 0 }];
        storage.state.products = [{ id: 'beer', name: 'Øl', icon: '🍺' }, { id: 'juice', name: 'Saft <stor>', icon: '' }];
        storage.state.transactions = [
            { customerId: 'one', type: 'purchase', productId: 'beer' },
            { customerId: 'one', type: 'purchase', productId: 'beer' },
            { customerId: 'one', type: 'purchase', productId: 'juice' },
            { customerId: 'one', type: 'payment', productId: 'beer' },
            { customerId: 'two', type: 'purchase', productId: 'beer' }
        ];
        const render = () => {
            ui.renderCustomerList(customers, null, () => {}, () => {}, () => {}, () => {});
            return elements.get('active-customer-list').innerHTML;
        };
        let html = render();
        assert.match(html, /🍺 ×2/);
        assert.match(html, /Saft &lt;stor&gt; ×1/);
        assert.match(html, /🍺 ×1/);
        storage.state.transactions.shift();
        assert.doesNotMatch(render(), /🍺 ×2/);
        storage.state.transactions[0].productId = 'juice';
        html = render();
        assert.match(html, /Saft &lt;stor&gt; ×2/);
        assert.doesNotMatch(html.split('data-customer-id="two"')[0], /🍺 ×/);
        storage.state.transactions = [];
        assert.doesNotMatch(render(), /customer-item-counts/);
    } finally {
        global.document = previousDocument;
    }
});
