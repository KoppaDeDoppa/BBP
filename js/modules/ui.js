/**
 * UI Module - Handles DOM rendering and UI updates
 * BodenBar v1.4
 */

import { storage, DEFAULT_PRODUCTS } from './storage.js';

// Check if customer has made any payment transactions
function hasMadePayment(customerId) {
    const transactions = storage.getCustomerTransactions(customerId);
    return transactions.some(t => t.type === 'payment');
}

// DOM Elements Cache
let elements = {};

// Initialize DOM element references
export function initElements() {
    elements = {
        // Header
        currentTime: document.getElementById('current-time'),
        adminBtn: document.getElementById('admin-btn'),

        // Dashboard
        statRevenue: document.getElementById('stat-revenue'),
        statPaid: document.getElementById('stat-paid'),
        statOutstanding: document.getElementById('stat-outstanding'),
        statCustomers: document.getElementById('stat-customers'),

        // Products
        productsGrid: document.getElementById('products-grid'),

        // Customer Panel
        addCustomerBtn: document.getElementById('add-customer-btn'),
        activeCustomerDisplay: document.getElementById('active-customer-display'),
        customerDetails: document.getElementById('customer-details'),
        customerName: document.getElementById('customer-name'),
        customerStatus: document.getElementById('customer-status'),
        lastPurchase: document.getElementById('last-purchase'),
        customerBalance: document.getElementById('customer-balance'),
        undoBtn: document.getElementById('undo-btn'),
        correctBtn: document.getElementById('correct-btn'),
        historyBtn: document.getElementById('history-btn'),

        // Customer Lists
        tabActive: document.getElementById('tab-active'),
        tabPaid: document.getElementById('tab-paid'),
        tabArchived: document.getElementById('tab-archived'),
        activeCustomerList: document.getElementById('active-customer-list'),
        paidCustomerList: document.getElementById('paid-customer-list'),
        archivedCustomerList: document.getElementById('archived-customer-list'),

        // Action Bar
        settlementBtn: document.getElementById('settlement-btn'),
        reportsBtn: document.getElementById('reports-btn'),

        // Modals Container
        modalsContainer: document.getElementById('modals-container')
    };
}

// Format currency
export function formatCurrency(amount) {
    return `${amount.toLocaleString('nb-NO')} kr`;
}

// Format date/time
export function formatDateTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('nb-NO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString('nb-NO', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString('nb-NO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Update clock
export function updateClock() {
    if (elements.currentTime) {
        const now = new Date();
        elements.currentTime.textContent = now.toLocaleTimeString('nb-NO', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

// Render Products
export function renderProducts(onProductClick) {
    if (!elements.productsGrid) return;

    elements.productsGrid.innerHTML = DEFAULT_PRODUCTS.map(product => `
        <button class="product-btn" data-product="${product.id}" data-price="${product.price}" aria-label="${product.name}, ${product.price === 0 ? 'Gratis' : formatCurrency(product.price)}">
            <span class="product-icon">${product.icon}</span>
            <div class="product-info">
                <div class="product-name">${product.name}</div>
                <div class="product-price ${product.price === 0 ? 'free' : ''}">${product.price === 0 ? 'Gratis' : formatCurrency(product.price)}</div>
            </div>
            ${product.member ? '<span class="product-tag">Medlem</span>' : ''}
        </button>
    `).join('');

    // Add click listeners
    elements.productsGrid.querySelectorAll('.product-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const productId = btn.dataset.product;
            const price = parseInt(btn.dataset.price, 10);
            onProductClick(productId, price);
        });
    });
}

// Render Dashboard Stats
export function renderDashboard(stats) {
    if (!elements.statRevenue) return;

    const updateStat = (el, value, isCurrency = true) => {
        if (el) {
            const newValue = isCurrency ? formatCurrency(value) : value;
            if (el.textContent !== newValue) {
                el.textContent = newValue;
                el.classList.add('updated');
                setTimeout(() => el.classList.remove('updated'), 500);
            }
        }
    };

    updateStat(elements.statRevenue, stats.revenue || 0);
    updateStat(elements.statPaid, stats.paid || 0);
    updateStat(elements.statOutstanding, stats.outstanding || 0);
    updateStat(elements.statCustomers, stats.activeCustomers || 0, false);
}

// Render Active Customer
export function renderActiveCustomer(customer) {
    if (!elements.activeCustomerDisplay || !elements.customerDetails) return;

    if (!customer) {
        elements.activeCustomerDisplay.querySelector('.no-customer-selected').classList.remove('hidden');
        elements.customerDetails.classList.add('hidden');
        elements.undoBtn.disabled = true;
        elements.correctBtn.disabled = true;
        elements.historyBtn.disabled = true;
        return;
    }

    elements.activeCustomerDisplay.querySelector('.no-customer-selected').classList.add('hidden');
    elements.customerDetails.classList.remove('hidden');

    if (elements.customerName) elements.customerName.textContent = customer.name;
    if (elements.customerStatus) {
        const hasPaid = hasMadePayment(customer.id);
        let statusText, statusClass;
        if (customer.archived) {
            statusText = 'Arkivert';
            statusClass = 'archived';
        } else if (customer.balance > 0) {
            statusText = 'Utestående';
            statusClass = 'outstanding';
        } else if (hasPaid) {
            statusText = 'Betalt';
            statusClass = 'paid';
        } else {
            statusText = 'Aktiv';
            statusClass = 'active';
        }
        elements.customerStatus.textContent = statusText;
        elements.customerStatus.className = 'status-badge ' + statusClass;
    }
    if (elements.lastPurchase) {
        const transactions = storage.getCustomerTransactions(customer.id);
        elements.lastPurchase.textContent = transactions.length > 0 ? formatDateTime(transactions[0].timestamp) : '–';
    }
    if (elements.customerBalance) {
        elements.customerBalance.textContent = formatCurrency(customer.balance);
        elements.customerBalance.className = 'stat-item-value balance ' +
            (customer.balance > 0 ? 'positive' : customer.balance < 0 ? 'negative' : 'zero');
    }

    elements.undoBtn.disabled = false;
    elements.correctBtn.disabled = false;
    elements.historyBtn.disabled = false;
}

// Render Customer List
export function renderCustomerList(customers, activeCustomerId, onSelect, onArchive, onUnarchive, onDelete, showArchived = false, showPaid = false) {
    let listEl;
    let filtered;
    let emptyText;

    if (showPaid) {
        listEl = elements.paidCustomerList;
        // Betalt: not archived, balance = 0, AND has made at least one payment
        filtered = customers.filter(c => !c.archived && c.balance === 0 && hasMadePayment(c.id));
        emptyText = 'Ingen betalte kunder';
    } else if (showArchived) {
        listEl = elements.archivedCustomerList;
        filtered = customers.filter(c => c.archived);
        emptyText = 'Ingen arkiverte kunder';
    } else {
        listEl = elements.activeCustomerList;
        // Aktive: not archived AND (balance !== 0 OR no payments made yet)
        filtered = customers.filter(c => !c.archived && (c.balance !== 0 || !hasMadePayment(c.id)));
        emptyText = 'Ingen aktive kunder';
    }

    if (!listEl) return;

    if (filtered.length === 0) {
        listEl.innerHTML = `<li class="empty-list">${emptyText}</li>`;
        return;
    }

    listEl.innerHTML = filtered.map(customer => `
        <li class="customer-list-item ${customer.id === activeCustomerId ? 'selected' : ''} ${customer.archived ? 'archived' : ''}"
            data-customer-id="${customer.id}"
            role="button"
            tabindex="0"
            aria-selected="${customer.id === activeCustomerId}"
            aria-label="${customer.name}, saldo: ${formatCurrency(customer.balance)}">
            <div class="customer-list-info">
                <span class="customer-list-name">${escapeHtml(customer.name)}</span>
                <span class="customer-list-balance ${customer.balance > 0 ? 'positive' : customer.balance < 0 ? 'negative' : 'zero'}">
                    ${formatCurrency(customer.balance)}
                </span>
            </div>
            <div class="customer-list-actions">
                ${showArchived
                    ? `<button class="btn btn-icon btn-ghost" data-action="unarchive" aria-label="Gjenopprett ${escapeHtml(customer.name)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                      </button>`
                    : `<button class="btn btn-icon btn-ghost" data-action="archive" aria-label="Arkiver ${escapeHtml(customer.name)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="21 8 21 12 17 12"></polyline>
                            <path d="M22 3H8a2 2 0 0 0-2 2v3m18 0v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3"></path>
                        </svg>
                      </button>`
                }
                <button class="btn btn-icon btn-ghost btn-danger-ghost" data-action="delete" aria-label="Slett ${escapeHtml(customer.name)}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1-2-2m0 0a2 2 0 0 0 2 2m0 0v6"></path>
                    </svg>
                </button>
            </div>
        </li>
    `).join('');

    // Add click listeners
    listEl.querySelectorAll('.customer-list-item').forEach(item => {
        const customerId = item.dataset.customerId;

        // Main click - select customer
        item.addEventListener('click', (e) => {
            if (!e.target.closest('[data-action]')) {
                onSelect(customerId);
            }
        });

        // Keyboard support
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!e.target.closest('[data-action]')) {
                    onSelect(customerId);
                }
            }
        });

        // Action buttons
        item.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'archive') onArchive(customerId);
                if (action === 'unarchive') onUnarchive(customerId);
                if (action === 'delete') onDelete(customerId);
            });
        });
    });
}

// Switch customer list tab
// tabType: 'active', 'paid', or 'archived'
export function switchCustomerTab(tabType) {
    if (!elements.tabActive || !elements.tabPaid || !elements.tabArchived ||
        !elements.activeCustomerList || !elements.paidCustomerList || !elements.archivedCustomerList) return;

    // Reset all tabs
    const tabs = [
        { btn: elements.tabActive, list: elements.activeCustomerList },
        { btn: elements.tabPaid, list: elements.paidCustomerList },
        { btn: elements.tabArchived, list: elements.archivedCustomerList }
    ];

    tabs.forEach(({ btn, list }) => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
        list.classList.add('hidden');
    });

    // Activate selected tab
    const activeTab = tabs.find(t =>
        (tabType === 'active' && t.btn === elements.tabActive) ||
        (tabType === 'paid' && t.btn === elements.tabPaid) ||
        (tabType === 'archived' && t.btn === elements.tabArchived)
    );

    if (activeTab) {
        activeTab.btn.classList.add('active');
        activeTab.btn.setAttribute('aria-selected', 'true');
        activeTab.list.classList.remove('hidden');
    }
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show toast notification
export function showToast(message, type = 'info', duration = 3000) {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const icons = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" aria-label="Lukk">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));
    container.appendChild(toast);

    // Auto remove
    setTimeout(() => removeToast(toast), duration);
}

function getOrCreateToastContainer() {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function removeToast(toast) {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
}

// Show loading state on button
export function setButtonLoading(btn, loading, originalText = '') {
    if (!btn) return;

    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span> ${originalText || 'Laster...'}`;
        btn.disabled = true;
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.textContent;
        btn.disabled = false;
        delete btn.dataset.originalText;
    }
}

// Debounce utility
export function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

// Throttle utility
export function throttle(fn, limit) {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}