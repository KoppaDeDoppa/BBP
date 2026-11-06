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
    c.querySelector('form').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await storage.login(f.get('username'), f.get('password')); c.innerHTML=''; initElements(); initApp(); } catch(err) { c.querySelector('#login-error').textContent=err.message; } };
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

    // Add Customer
    el.getElementById('add-customer-btn')?.addEventListener('click', () => showCustomerModal());

    // Active Customer Actions
    el.getElementById('undo-btn')?.addEventListener('click', handleUndoLast);
    el.getElementById('correct-btn')?.addEventListener('click', handleCorrectPurchase);
    el.getElementById('history-btn')?.addEventListener('click', handleShowHistory);

    // Customer List Tabs
    el.getElementById('tab-active')?.addEventListener('click', () => {
        currentCustomerTab = 'active';
        switchCustomerTab('active');
        renderCustomerLists();
    });
    el.getElementById('tab-paid')?.addEventListener('click', () => {
        currentCustomerTab = 'paid';
        switchCustomerTab('paid');
        renderCustomerLists();
    });
    el.getElementById('tab-archived')?.addEventListener('click', () => {
        currentCustomerTab = 'archived';
        switchCustomerTab('archived');
        renderCustomerLists();
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
}

// Product Click Handler
async function handleProductClick(productId) {
    if (!getActiveCustomerId()) {
        showToast('Velg en kunde først', 'warning');
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
}

// Archive Customer
function handleArchiveCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    showConfirmModal(
        'Arkiver kunde',
        `Er du sikker på at du vil arkivere <strong>${customer.name}</strong>? Kunden vil fortsatt bli med i rapporter, men skjules fra listen over aktive kunder.`,
        'warning',
        () => {
            storage.archiveCustomer(customerId);
            if (getActiveCustomerId() === customerId) {
                setActiveCustomerId(null);
                renderActiveCustomer(null);
            }
            renderCustomerLists();
            renderDashboard(storage.getDailyStats());
            showToast(`${customer.name} arkivert`, 'info');
        }
    );
}

// Unarchive Customer
function handleUnarchiveCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    storage.unarchiveCustomer(customerId);
    renderCustomerLists();
    renderDashboard(storage.getDailyStats());
    showToast(`${customer.name} gjenopprettet`, 'success');
}

// Delete Customer
function handleDeleteCustomer(customerId) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    showConfirmModal(
        'Slett kunde',
        `Er du sikker på at du vil <strong>permanente slett</strong> <strong>${customer.name}</strong>? Alle kjøp, betalinger og historikk vil forsvinne og kan ikke gjenopprettes.`,
        'danger',
        () => {
            storage.deleteCustomer(customerId);
            if (getActiveCustomerId() === customerId) {
                setActiveCustomerId(null);
                renderActiveCustomer(null);
            }
            renderCustomerLists();
            renderDashboard(storage.getDailyStats());
            showToast(`${customer.name} slettet`, 'error');
        }
    );
}

// Undo Last Purchase
function handleUndoLast() {
    if (!getActiveCustomerId()) return;

    const customer = storage.getCustomer(getActiveCustomerId());
    if (!customer) return;

    const removed = storage.removeLastTransaction(getActiveCustomerId());
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
}

// Correct Purchase
function handleCorrectPurchase() {
    if (!getActiveCustomerId()) return;

    const transactions = storage.getCustomerTransactions(getActiveCustomerId());
    if (transactions.length === 0) {
        showToast('Ingen kjøp å korrigere', 'warning');
        return;
    }

    showCorrectionModal(getActiveCustomerId(), transactions[0], (newAmount, newProductId) => {
        const customer = storage.getCustomer(getActiveCustomerId());
        const oldTransaction = transactions[0];
        const oldAmount = oldTransaction.amount;

        // Calculate difference
        const diff = newAmount - oldAmount;
        const newBalance = customer.balance + diff;

        // Update transaction
        storage.correctTransaction(oldTransaction.id, {
            amount: newAmount,
            productId: newProductId,
            productName: storage.getProduct(newProductId)?.name || 'Ukjent'
        });

        // Update customer balance
        storage.updateCustomer(getActiveCustomerId(), { balance: newBalance });

        renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
        renderCustomerLists();
        renderDashboard(storage.getDailyStats());
        showToast('Kjøp korrigert', 'success');
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
function refreshUI() {
    renderProducts(handleProductClick);
    renderDashboard(storage.getDailyStats());
    renderCustomerLists();
    if (getActiveCustomerId()) {
        renderActiveCustomer(storage.getCustomer(getActiveCustomerId()));
    }
}

// Export functions for modals to use
export { storage, getActiveCustomerId, setActiveCustomerId, refreshUI, formatCurrency, formatDateTime };

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}