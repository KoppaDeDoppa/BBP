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
        storage.state.products.push(
            { id: 'beer-keg', name: 'Øl', icon: '🍺', fat: true },
            { id: 'beer-keg-member', name: 'Øl', icon: '🍺', fat: true, member: true },
            { id: 'juice-keg', name: 'Saft <stor>', icon: '', fat: true }
        );
        storage.state.transactions = [
            { customerId: 'one', type: 'purchase', productId: 'beer' },
            { customerId: 'one', type: 'purchase', productId: 'beer-keg' },
            { customerId: 'one', type: 'purchase', productId: 'beer-keg' },
            { customerId: 'one', type: 'purchase', productId: 'beer-keg-member' },
            { customerId: 'one', type: 'purchase', productId: 'juice-keg' }
        ];
        html = render();
        assert.match(html, /🍺 ×1/);
        assert.match(html, /🍺 \(F\) ×2/);
        assert.match(html, /🍺 \(F\) \(M\) ×1/);
        assert.match(html, /Saft &lt;stor&gt; \(F\) ×1/);
        assert.match(html, /aria-label="Øl \[Fat\] \[Medlem\]: 1"/);
        assert.match(html, /title="Saft &lt;stor&gt; \[Fat\]: 1"/);
        ui.renderProducts(() => {});
        const products = elements.get('products-grid').innerHTML;
        assert.match(products, /class="product-badge">Fat/);
        assert.match(products, /class="product-badge">Medlem<\/span><span class="product-badge">Fat/);
        storage.state.transactions = [];
        assert.doesNotMatch(render(), /customer-item-counts/);
    } finally {
        global.document = previousDocument;
    }
});
