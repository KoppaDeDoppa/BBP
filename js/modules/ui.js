import {
    storage
} from './storage.js';
let elements = {};
export function initElements() {
    elements = Object.fromEntries(['currentTime', 'adminBtn', 'statRevenue', 'statPaid', 'statOutstanding', 'statCustomers', 'productsGrid', 'addCustomerBtn', 'activeCustomerDisplay', 'customerDetails', 'customerName', 'customerStatus', 'lastPurchase', 'customerBalance', 'undoBtn', 'correctBtn', 'historyBtn', 'tabActive', 'tabPaid', 'tabArchived', 'activeCustomerList', 'paidCustomerList', 'archivedCustomerList', 'settlementBtn', 'reportsBtn', 'modalsContainer'].map(k => [k, document.getElementById(k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()))]));
    elements.currentTime = document.getElementById('current-time');
    elements.adminBtn = document.getElementById('admin-btn');
    elements.statRevenue = document.getElementById('stat-revenue');
    elements.statPaid = document.getElementById('stat-paid');
    elements.statOutstanding = document.getElementById('stat-outstanding');
    elements.statCustomers = document.getElementById('stat-customers');
    elements.productsGrid = document.getElementById('products-grid');
    elements.addCustomerBtn = document.getElementById('add-customer-btn');
    elements.activeCustomerDisplay = document.getElementById('active-customer-display');
    elements.customerDetails = document.getElementById('customer-details');
    elements.customerName = document.getElementById('customer-name');
    elements.customerStatus = document.getElementById('customer-status');
    elements.lastPurchase = document.getElementById('last-purchase');
    elements.customerBalance = document.getElementById('customer-balance');
    elements.undoBtn = document.getElementById('undo-btn');
    elements.correctBtn = document.getElementById('correct-btn');
    elements.historyBtn = document.getElementById('history-btn');
    elements.tabActive = document.getElementById('tab-active');
    elements.tabPaid = document.getElementById('tab-paid');
    elements.tabArchived = document.getElementById('tab-archived');
    elements.activeCustomerList = document.getElementById('active-customer-list');
    elements.paidCustomerList = document.getElementById('paid-customer-list');
    elements.archivedCustomerList = document.getElementById('archived-customer-list');
    elements.settlementBtn = document.getElementById('settlement-btn');
    elements.reportsBtn = document.getElementById('reports-btn');
    elements.modalsContainer = document.getElementById('modals-container');
}
export const formatCurrency = n => `${(Number(n)||0).toLocaleString('nb-NO')} kr`;
export const formatDateTime = s => new Date(s).toLocaleString('nb-NO');
export const formatTime = s => new Date(s).toLocaleTimeString('nb-NO');
export const formatDate = s => new Date(s).toLocaleDateString('nb-NO');
export function updateClock() {
    if (elements.currentTime) elements.currentTime.textContent = new Date().toLocaleTimeString('nb-NO');
}
export function renderProducts(onClick) {
    if (elements.productsGrid) elements.productsGrid.innerHTML = storage.getProducts().map(p => `<button data-product="${escapeHtml(p.id)}" data-price="${p.price}"><span class="product-icon">${escapeHtml(p.icon)}</span><div>${escapeHtml(p.name)}<br>${p.price===0?'Gratis':formatCurrency(p.price)}</div>${p.member || p.fat ? `<small class="product-badges">${p.member ? '<span class="product-badge">Medlem</span>' : ''}${p.fat ? '<span class="product-badge">Fat</span>' : ''}</small>` : ''}</button>`).join('');
    elements.productsGrid?.querySelectorAll('[data-product]').forEach(b => b.onclick = () => onClick(b.dataset.product));
}
export function renderDashboard(s = {}) {
    [
        ['statRevenue', s.revenue],
        ['statPaid', s.paid],
        ['statOutstanding', s.outstanding],
        ['statCustomers', s.activeCustomers]
    ].forEach(([k, v]) => {
        if (elements[k]) elements[k].textContent = k === 'statCustomers' ? (v || 0) : formatCurrency(v);
    });
}
export function renderActiveCustomer(c) {
    if (!elements.customerDetails) return;
    const none = document.getElementById('no-customer-selected');
    const mobileName = document.getElementById('mobile-customer-name');
    const mobileBalance = document.getElementById('mobile-customer-balance');
    if (mobileName) mobileName.textContent = c?.name || 'Ingen kunde valgt';
    if (mobileBalance) mobileBalance.textContent = c ? formatCurrency(c.balance) : 'Velg en kunde først';
    if (!c) {
        if (none) none.hidden = false;
        elements.customerDetails.hidden = true;
        return;
    }
    if (none) none.hidden = true;
    elements.customerDetails.hidden = false;
    elements.customerName.textContent = c.name;
    elements.customerBalance.textContent = formatCurrency(c.balance);
    const t = storage.getCustomerTransactions(c.id);
    elements.lastPurchase.textContent = t[0] ? formatDateTime(t[0].timestamp) : '–';
    elements.customerStatus.textContent = c.archived ? 'Arkivert' : c.balance > 0 ? 'Utestående' : storage.hasMadePayment(c.id) ? 'Betalt' : 'Aktiv';
    elements.undoBtn.disabled = !t.length;
    elements.correctBtn.disabled = !t.length;
    elements.historyBtn.disabled = false;
}

function customerItemCounts() {
    const customers = new Map();
    const products = new Map(storage.getProducts().map(p => [p.id, p]));
    for (const transaction of storage.getTransactions()) {
        if (transaction.type !== 'purchase') continue;
        const items = customers.get(transaction.customerId) || new Map();
        customers.set(transaction.customerId, items);
        const key = transaction.productId || transaction.productName;
        const product = products.get(transaction.productId);
        const item = items.get(key) || {
            name: product?.name || transaction.productName || 'Ukjent produkt',
            icon: product?.icon || '',
            member: product?.member || false,
            fat: product?.fat || false,
            count: 0
        };
        item.count += 1;
        items.set(key, item);
    }
    return customers;
}

function renderItemCounts(items) {
    if (!items?.size) return '';
    return `<small class="customer-item-counts">${Array.from(items.values(), item => {
        const label = `${item.name}${item.fat ? ' [Fat]' : ''}${item.member ? ' [Medlem]' : ''}: ${item.count}`;
        return `<span class="customer-item-count" title="${escapeHtml(label).replace(/"/g, '&quot;')}" aria-label="${escapeHtml(label).replace(/"/g, '&quot;')}">${escapeHtml(item.icon || item.name)}${item.fat ? ' (F)' : ''}${item.member && item.icon ? ' (M)' : ''} ×${item.count}</span>`;
    }).join('')}</small>`;
}
export function renderCustomerList(cs, active, onSelect, onArchive, onUnarchive, onDelete, archived = false, paid = false) {
    const counts = customerItemCounts();
    const list = archived ? elements.archivedCustomerList : paid ? elements.paidCustomerList : elements.activeCustomerList;
    const filtered = cs.filter(c => archived ? c.archived : paid ? !c.archived && c.balance === 0 && storage.hasMadePayment(c.id) : !c.archived && (c.balance !== 0 || !storage.hasMadePayment(c.id)));
    list.innerHTML = filtered.map(c => `<li data-customer-id="${c.id}" aria-selected="${c.id===active}"><div><div class="customer-name-line"><span class="customer-list-name">${escapeHtml(c.name)}</span>${renderItemCounts(counts.get(c.id))}</div><span class="customer-list-balance">${formatCurrency(c.balance)}</span></div><div><button type="button" data-action="${archived?'unarchive':'archive'}" aria-label="${archived?'Gjenopprett':'Arkiver'} kunde">${archived?'Gjenopprett':'Arkiver'}</button><button type="button" data-action="delete" aria-label="Slett kunde">Slett</button></div></li>`).join('') || '<li>Ingen kunder</li>';
    list.querySelectorAll('[data-customer-id]').forEach(li => {
        li.onclick = e => {
            const id = li.dataset.customerId;
            if (e.target.dataset.action === 'delete') onDelete(id);
            else if (e.target.dataset.action === 'archive') onArchive(id);
            else if (e.target.dataset.action === 'unarchive') onUnarchive(id);
            else onSelect(id);
        };
    });
}
export function switchCustomerTab(t) {
    const l = {
        active: elements.activeCustomerList,
        paid: elements.paidCustomerList,
        archived: elements.archivedCustomerList
    };
    Object.entries(l).forEach(([k, v]) => {
        v.hidden = k !== t;
    });
    document.querySelectorAll('[data-customer-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.customerTab === t)));
}

function escapeHtml(x) {
    const d = document.createElement('div');
    d.textContent = x;
    return d.innerHTML;
}
export function showToast(message, type = 'info', duration = 3000) {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        document.body.append(c);
    }
    const d = document.createElement('div');
    d.textContent = message;
    d.setAttribute('role', 'alert');
    c.append(d);
    setTimeout(() => d.remove(), duration);
}
export function setButtonLoading(b, on, text = '') {
    if (!b) return;
    if (on) {
        b.dataset.originalText = b.innerHTML;
        b.disabled = true;
        b.textContent = text || 'Laster...';
    } else {
        b.innerHTML = b.dataset.originalText || b.textContent;
        b.disabled = false;
        delete b.dataset.originalText;
    }
}
export const debounce = (f, d) => {
    let t;
    return (...a) => {
        clearTimeout(t);
        t = setTimeout(() => f(...a), d);
    };
};
export const throttle = (f, d) => {
    let t = false;
    return (...a) => {
        if (!t) {
            f(...a);
            t = true;
            setTimeout(() => t = false, d);
        }
    };
};
