/**
 * BodenBar - Main Application Entry Point
 * Handles all event wiring and application state
 * BodenBar v1.4
 */

import { storage } from './modules/storage.js';
import {
    initElements,
    renderProducts,
    renderDashboard,
    renderActiveCustomer,
    renderCustomerList,
    switchCustomerTab,
    formatCurrency,
    formatDateTime,
    updateClock,
    showToast,
    setButtonLoading
} from './modules/ui.js';
import { showModal, closeModal, showConfirmModal, showCustomerModal, showHistoryModal, showCorrectionModal, showSettlementModal, showReportsModal, showAdminModal } from './modules/modals.js';
import { getActiveCustomerId, setActiveCustomerId, clearActiveCustomerId } from './modules/state.js';

// Application State
let currentCustomerTab = 'active'; // 'active', 'paid', 'archived'
let mobileView = 'customers'; // 'customers', 'products', 'details'
const mobileBreakpoint = window.matchMedia('(max-width: 767px)');

function syncMobileLayout() {
    const isMobile = mobileBreakpoint.matches;
    const panelsByView = {
        customers: 'dashboard-panel',
        products: 'products-panel',
        details: 'customer-panel'
    };
    const visiblePanelId = panelsByView[mobileView];

    Object.values(panelsByView).forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = isMobile && panelId !== visiblePanelId;
    });

    const nav = document.getElementById('mobile-pos-nav');
    if (nav) nav.hidden = !isMobile;

    document.querySelectorAll('[data-mobile-view]').forEach(button => {
        if (button.dataset.mobileView === mobileView) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
    });
}

function setMobileView(view, focusHeading = false) {
    if (!['customers', 'products', 'details'].includes(view)) return;
    mobileView = view;
    syncMobileLayout();

    if (focusHeading && mobileBreakpoint.matches) {
        const headings = {
            customers: 'customer-list-heading',
            products: 'products-heading',
            details: 'customer-heading'
        };
        document.getElementById(headings[view])?.focus({ preventScroll: true });
    }
}

// Initialize App
async function initApp() {
    // Initialize DOM elements
    initElements();

    // Authenticate before loading authoritative state.
    await storage.init();
    if (!storage.user) { showLogin(); return; }
    renderProducts(handleProductClick);
    renderDashboard(storage.getDailyStats());
    renderCustomerLists();
    renderActiveCustomer(null);
    setActiveCustomerId(null);

    // Set up event listeners
    setupEventListeners();
    mobileBreakpoint.onchange = syncMobileLayout;
    syncMobileLayout();

    applyRoleUI();
    window.addEventListener('focus', refreshFromServer);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFromServer(); });
    setInterval(refreshFromServer, 5000);
    // Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // Check daily reset periodically
    setInterval(() => storage.checkDailyReset(), 60000);

    console.log('BodenBar v1.4 initialized');
}

function showLogin() {
    const c = document.getElementById('modals-container');
    c.innerHTML = '<form id="login-form"><h2>Logg inn</h2><label>Brukernavn<input name="username" autocomplete="username" required></label><label>Passord<input name="password" type="password" autocomplete="current-password" required></label><button>Logg inn</button><p id="login-error" role="alert"></p></form>';
    c.setAttribute('aria-hidden','false');
    c.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await storage.login(f.get('username'), f.get('password')); c.innerHTML=''; c.setAttribute('aria-hidden','true'); initElements(); initApp(); } catch(err) { c.querySelector('#login-error').textContent=err.message; } };
}
function applyRoleUI() {
    const admin = storage.isAdmin();
    document.getElementById('admin-btn').hidden = !admin;
    document.getElementById('logout-btn').hidden = false;
    document.getElementById('current-user').textContent = storage.user?.username || storage.user?.name || '';
    if (!admin) { document.getElementById('reports-btn').hidden=true; document.getElementById('settlement-btn').hidden=true; }
    document.getElementById('logout-btn').onclick = async () => { await storage.logout(); location.reload(); };
}
async function refreshFromServer() {
    try { const result=await storage.loadState(storage.revision); if (!result.unchanged) { renderProducts(handleProductClick); renderDashboard(storage.getDailyStats()); renderCustomerLists(); const id=getActiveCustomerId(); if(id) renderActiveCustomer(storage.getCustomer(id)); } }
    catch(error) { if (error.message.includes('401')) { storage.user=null; showLogin(); } }
}

// Event Listeners Setup
function setupEventListeners() {
    const el = document; // Use document for delegated events

    // Header
    el.getElementById('admin-btn')?.addEventListener('click', () => showAdminModal());

    const fullscreenButton = el.getElementById('fullscreen-btn');
    if (fullscreenButton) {
        const syncFullscreenButton = () => {
            const active = Boolean(document.fullscreenElement);
            fullscreenButton.setAttribute('aria-pressed', String(active));
            fullscreenButton.setAttribute('aria-label', active ? 'Avslutt fullskjerm' : 'Fullskjerm');
            fullscreenButton.title = active ? 'Avslutt fullskjerm' : 'Fullskjerm';
            fullscreenButton.innerHTML = active
                ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m13-5h-3a2 2 0 0 0-2 2v3"></path></svg>'
                : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>';
        };
        if (!document.documentElement.requestFullscreen) fullscreenButton.hidden = true;
        fullscreenButton.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            } catch {
                showToast('Fullskjerm støttes ikke i denne nettleseren', 'warning');
            }
        });
        document.addEventListener('fullscreenchange', syncFullscreenButton);
        syncFullscreenButton();
    }

    // Phone navigation
    el.getElementById('mobile-pos-nav')?.addEventListener('click', event => {
        const button = event.target.closest('[data-mobile-view]');
        if (!button) return;

        const view = button.dataset.mobileView;
        if (view === 'products' && !getActiveCustomerId()) {
            showToast('Velg en kunde først', 'warning');
            setMobileView('customers', true);
            return;
        }

        setMobileView(view, true);
    });

    // Add Customer
    el.getElementById('add-customer-btn')?.addEventListener('click', () => showCustomerModal());

    // Active Customer Actions
    el.getElementById('undo-btn')?.addEventListener('click', handleUndoLast);
    el.getElementById('correct-btn')?.addEventListener('click', handleCorrectPurchase);
    el.getElementById('history-btn')?.addEventListener('click', handleShowHistory);

    // Customer list filters (desktop and mobile controls share one state)
    el.querySelectorAll('[data-customer-tab]').forEach(button => {
        button.addEventListener('click', () => {
            currentCustomerTab = button.dataset.customerTab;
            switchCustomerTab(currentCustomerTab);
            renderCustomerLists();
        });
    });

    // Action Bar
    el.getElementById('settlement-btn')?.addEventListener('click', () => showSettlementModal());
    el.getElementById('reports-btn')?.addEventListener('click', () => showReportsModal());

    // Modal close buttons (delegated)
    el.getElementById('modals-container')?.addEventListener('click', (e) => {
        if (e.target.closest('[aria-label="Lukk"]') || e.target === e.currentTarget) {
            closeModal();
        }
    });

    // Keyboard: Escape to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// Render Customer Lists (active, paid, archived)
function renderCustomerLists() {
    const customers = storage.getAllCustomers();
    const showArchived = currentCustomerTab === 'archived';
    const showPaid = currentCustomerTab === 'paid';
    renderCustomerList(
        customers,
        getActiveCustomerId(),
        handleSelectCustomer,
        handleArchiveCustomer,
        handleUnarchiveCustomer,
        handleDeleteCustomer,
        showArchived,
        showPaid
    );
    switchCustomerTab(currentCustomerTab);
}

// Product Click Handler
async function handleProductClick(productId) {
    if (!getActiveCustomerId()) {
        showToast('Velg en kunde først', 'warning');
        setMobileView('customers', true);
        return;
    }

    const customer = storage.getCustomer(getActiveCustomerId());
    if (!customer) {
        showToast('Kunde ikke funnet', 'error');
        return;
    }

    const product = storage.getProduct(productId);
    if (!product) {
        showToast('Produktet finnes ikke lenger', 'error');
        return;
    }
    const currentPrice = product.price;

    // Add transaction
    try {
    await storage.addTransaction({
        customerId: getActiveCustomerId(),
        type: 'purchase',
        productId: productId,
        productName: product.name,
        amount: currentPrice,
        price: currentPrice
    });

    // Update UI
    renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
    renderCustomerLists();
    renderDashboard(storage.getDailyStats());

    showToast(`${product.name} lagt til for ${customer.name}`, 'success');
    } catch (error) { showToast(error.message, 'error'); }
}

// Select Customer
function handleSelectCustomer(customerId) {
    setActiveCustomerId(customerId);
    const customer = storage.getCustomer(customerId);
    renderActiveCustomer(customer);
    renderCustomerLists();
    setMobileView('products', true);
}

// Archive Customer
function handleArchiveCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    showConfirmModal(
        'Arkiver kunde',
        `Er du sikker på at du vil arkivere <strong>${customer.name}</strong>? Kunden vil fortsatt bli med i rapporter, men skjules fra listen over aktive kunder.`,
        'warning',
        async () => {
            try {
                await storage.archiveCustomer(customerId);
                if (getActiveCustomerId() === customerId) {
                    setActiveCustomerId(null);
                    renderActiveCustomer(null);
                    setMobileView('customers', true);
                }
                renderCustomerLists();
                renderDashboard(storage.getDailyStats());
                showToast(`${customer.name} arkivert`, 'info');
            } catch (error) {
                showToast(error.message || 'Kunne ikke arkivere kunden', 'error');
            }
        }
    );
}

// Unarchive Customer
function handleUnarchiveCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    storage.unarchiveCustomer(customerId).then(() => {
        renderCustomerLists();
        renderDashboard(storage.getDailyStats());
        showToast(`${customer.name} gjenopprettet`, 'success');
    }).catch(error => showToast(error.message || 'Kunne ikke gjenopprette kunden', 'error'));
}

// Delete Customer
function handleDeleteCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    showConfirmModal(
        'Slett kunde',
        `Er du sikker på at du vil <strong>permanente slett</strong> <strong>${customer.name}</strong>? Alle kjøp, betalinger og historikk vil forsvinne og kan ikke gjenopprettes.`,
        'danger',
        async () => {
            try {
                await storage.deleteCustomer(customerId);
                if (getActiveCustomerId() === customerId) {
                    setActiveCustomerId(null);
                    renderActiveCustomer(null);
                    setMobileView('customers', true);
                }
                renderCustomerLists();
                renderDashboard(storage.getDailyStats());
                showToast(`${customer.name} slettet`, 'error');
            } catch (error) {
                showToast(error.message || 'Kunne ikke slette kunden', 'error');
            }
        }
    );
}

// Undo Last Purchase
function handleUndoLast() {
    if (!getActiveCustomerId()) return;

    const customer = storage.getCustomer(getActiveCustomerId());
    if (!customer) return;

    storage.removeLastTransaction(getActiveCustomerId()).then(removed => {
        if (!removed) {
            showToast('Ingen kjøp å angre', 'warning');
            return;
        }

        // Update customer balance
        const newBalance = customer.balance - removed.amount;
        storage.updateCustomer(getActiveCustomerId(), { balance: newBalance });

        renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
        renderCustomerLists();
        renderDashboard(storage.getDailyStats());
        showToast(`Angret ${removed.productName} (${formatCurrency(removed.amount)})`, 'info');
    }).catch(error => showToast(error.message || 'Kunne ikke angre', 'error'));
}

// Correct Purchase
function handleCorrectPurchase() {
    if (!getActiveCustomerId()) return;

    const transactions = storage.getCustomerTransactions(getActiveCustomerId());
    if (transactions.length === 0) {
        showToast('Ingen kjøp å korrigere', 'warning');
        return;
    }

    showCorrectionModal(getActiveCustomerId(), transactions[0], async (newAmount, newProductId) => {
        const customer = storage.getCustomer(getActiveCustomerId());
        const oldTransaction = transactions[0];
        const oldAmount = oldTransaction.amount;

        // Calculate difference
        const diff = newAmount - oldAmount;
        const newBalance = customer.balance + diff;

        try {
            // Update transaction
            await storage.correctTransaction(oldTransaction.id, {
                amount: newAmount,
                productId: newProductId,
                productName: storage.getProduct(newProductId)?.name || 'Ukjent'
            });

            // Update customer balance
            await storage.updateCustomer(getActiveCustomerId(), { balance: newBalance });

            renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
            renderCustomerLists();
            renderDashboard(storage.getDailyStats());
            showToast('Kjøp korrigert', 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke korrigere kjøpet', 'error');
        }
    });
}

// Show History
function handleShowHistory() {
    if (!getActiveCustomerId()) return;
    const customer = storage.getCustomer(getActiveCustomerId());
    if (!customer) return;

    showHistoryModal(customer);
}

// Refresh all UI
function refreshUI(options = {}) {
    renderProducts(handleProductClick);
    renderDashboard(storage.getDailyStats());
    renderCustomerLists();
    if (getActiveCustomerId()) {
        renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
    }
    if (options.mobileView) setMobileView(options.mobileView, true);
}

// Export functions for modals to use
export { storage, getActiveCustomerId, setActiveCustomerId, refreshUI, formatCurrency, formatDateTime };

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}