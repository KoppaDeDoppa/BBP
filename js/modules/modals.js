/**
 * Modals Module - Handles all modal dialogs
 * BodenBar v1.4
 */

import { storage, DEFAULT_PRODUCTS, DEFAULT_SETTINGS } from './storage.js';
import { formatCurrency, formatDateTime, showToast, setButtonLoading } from './ui.js';
import { refreshUI } from '../app.js';
import { setActiveCustomerId } from './state.js';

// Modal state
let currentModal = null;

/**
 * Show a modal with custom content
 */
export function showModal(content) {
    const container = document.getElementById('modals-container');
    if (!container) return;

    const modalHtml = `
        <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="modal">
                ${content}
            </div>
        </div>
    `;

    container.innerHTML = modalHtml;
    currentModal = container.querySelector('.modal-overlay');

    // Force reflow then add visible class to trigger animation
    requestAnimationFrame(() => {
        currentModal.classList.add('visible');

        // Second frame ensures browser has painted the visible state
        requestAnimationFrame(() => {
            // Focus management - focus first form field after modal is visible
            const formField = currentModal.querySelector('input, select, textarea');
            if (formField) {
                formField.focus();
            } else {
                const focusable = currentModal.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
                if (focusable) focusable.focus();
            }
        });
    });

    // Trap focus
    currentModal.addEventListener('keydown', trapFocus);
}

/**
 * Close the current modal
 */
export function closeModal() {
    const container = document.getElementById('modals-container');
    if (!container) return;

    const overlay = container.querySelector('.modal-overlay');
    if (overlay) {
        overlay.removeEventListener('keydown', trapFocus);
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => {
            container.innerHTML = '';
            currentModal = null;
        }, { once: true });
    } else {
        container.innerHTML = '';
        currentModal = null;
    }
}

/**
 * Focus trap for modal accessibility
 */
function trapFocus(e) {
    if (e.key !== 'Tab') return;

    const focusable = currentModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

/**
 * Show a confirmation modal
 */
export function showConfirmModal(title, message, type = 'warning', onConfirm) {
    const typeIcons = {
        warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    const content = `
        <div class="modal-header">
            <div class="modal-icon ${type}">${typeIcons[type] || typeIcons.warning}</div>
            <h3 id="modal-title">${title}</h3>
        </div>
        <div class="modal-body">
            <p>${message}</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary modal-cancel">Avbryt</button>
            <button class="btn btn-${type === 'danger' ? 'danger' : 'primary'} modal-confirm">${type === 'danger' ? 'Slett' : 'Bekreft'}</button>
        </div>
    `;

    showModal(content);

    const confirmBtn = document.querySelector('.modal-confirm');
    const cancelBtn = document.querySelector('.modal-cancel');

    const cleanup = () => {
        confirmBtn?.removeEventListener('click', handleConfirm);
        cancelBtn?.removeEventListener('click', handleCancel);
    };

    const handleConfirm = () => {
        cleanup();
        closeModal();
        if (onConfirm) onConfirm();
    };

    const handleCancel = () => {
        cleanup();
        closeModal();
    };

    confirmBtn?.addEventListener('click', handleConfirm);
    cancelBtn?.addEventListener('click', handleCancel);
}

/**
 * Show customer modal (add/edit)
 */
export function showCustomerModal(customer = null) {
    const isEdit = !!customer;
    const title = isEdit ? 'Rediger kunde' : 'Legg til ny kunde';

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">${title}</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <form id="customer-form" class="modal-body">
            <div class="form-group">
                <label for="customer-name-input">Navn</label>
                <input type="text" id="customer-name-input" name="name" required value="${customer?.name || ''}" placeholder="Kundenavn" autocomplete="name">
            </div>
            ${isEdit ? `
            <div class="form-group">
                <label>Saldo</label>
                <div class="balance-display ${customer.balance > 0 ? 'positive' : customer.balance < 0 ? 'negative' : 'zero'}">
                    ${formatCurrency(customer.balance)}
                </div>
            </div>
            ` : ''}
            <div class="modal-footer">
                <button class="btn btn-secondary modal-cancel" type="button">Avbryt</button>
                <button class="btn btn-primary modal-submit" type="submit">${isEdit ? 'Lagre' : 'Legg til'}</button>
            </div>
        </form>
    `;

    showModal(content);

    const form = document.getElementById('customer-form');
    const cancelBtn = document.querySelector('.modal-cancel');
    const closeBtn = document.querySelector('.modal-close');

    const cleanup = () => {
        form?.removeEventListener('submit', handleSubmit);
        cancelBtn?.removeEventListener('click', handleCancel);
        closeBtn?.removeEventListener('click', handleCancel);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('customer-name-input');
        const name = nameInput?.value?.trim();

        if (!name) {
            showToast('Navn er påkrevd', 'error');
            nameInput?.focus();
            return;
        }

        cleanup();
        closeModal();

        if (isEdit) {
            storage.updateCustomer(customer.id, { name });
            showToast(`${name} oppdatert`, 'success');
        } else {
            const newCustomer = storage.addCustomer(name);
            setActiveCustomerId(newCustomer.id);
            showToast(`${name} lagt til`, 'success');
        }
        refreshUI();
    };

    const handleCancel = () => {
        cleanup();
        closeModal();
    };

    form?.addEventListener('submit', handleSubmit);
    cancelBtn?.addEventListener('click', handleCancel);
    closeBtn?.addEventListener('click', handleCancel);
}

/**
 * Show settlement modal
 */
export function showSettlementModal() {
    const customers = storage.getCustomers().filter(c => c.balance !== 0);
    const settings = storage.getSettings();

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">Oppgjør</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="modal-body settlement-modal">
            ${customers.length === 0 ? `
                <p class="empty-state">Ingen kunder med utestående saldo</p>
            ` : `
                <div class="settlement-list">
                    ${customers.map(c => `
                        <div class="settlement-item" data-customer-id="${c.id}">
                            <div class="settlement-info">
                                <span class="settlement-name">${c.name}</span>
                                <span class="settlement-balance ${c.balance > 0 ? 'positive' : 'negative'}">${formatCurrency(c.balance)}</span>
                            </div>
                            <button class="btn btn-primary btn-sm settle-btn" data-customer-id="${c.id}" ${c.balance === 0 ? 'disabled' : ''}>
                                ${c.balance > 0 ? 'Registrer betaling' : 'Gjenopptak'}
                            </button>
                        </div>
                    `).join('')}
                </div>
            `}
            <div class="settlement-vipps">
                <h4>Vipps</h4>
                <div class="vipps-number">${settings.vippsNumber || 'Ikke konfigurert'}</button>
                <button class="btn btn-secondary btn-sm" id="copy-vipps">Kopier Vipps-nummer</button>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary modal-close-btn">Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = document.querySelector('.modal-close');
    const closeFooterBtn = document.querySelector('.modal-close-btn');
    const copyVippsBtn = document.getElementById('copy-vipps');

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
        copyVippsBtn?.removeEventListener('click', handleCopyVipps);
        document.querySelectorAll('.settle-btn').forEach(btn => {
            btn.removeEventListener('click', handleSettle);
        });
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    const handleCopyVipps = async () => {
        try {
            await navigator.clipboard.writeText(settings.vippsNumber || '');
            showToast('Vipps-nummer kopiert', 'success');
        } catch {
            showToast('Kunne ikke kopiere', 'error');
        }
    };

    const handleSettle = (e) => {
        const customerId = e.target.dataset.customerId;
        const customer = storage.getCustomer(customerId);
        if (!customer) return;

        if (customer.balance > 0) {
            // Register payment
            storage.addTransaction({
                customerId,
                type: 'payment',
                amount: customer.balance,
                productId: 'payment',
                productName: 'Betaling',
                price: customer.balance
            });
            storage.updateCustomer(customerId, { balance: 0 });
            showToast(`Betaling registrert for ${customer.name}`, 'success');
        } else {
            // Credit back (negative balance)
            storage.addTransaction({
                customerId,
                type: 'correction',
                amount: -customer.balance,
                productId: 'credit',
                productName: 'Gjenopptak',
                price: -customer.balance
            });
            storage.updateCustomer(customerId, { balance: 0 });
            showToast(`Gjenopptak registrert for ${customer.name}`, 'success');
        }

        cleanup();
        closeModal();
        refreshUI();
    };

    closeBtn?.addEventListener('click', handleClose);
    closeFooterBtn?.addEventListener('click', handleClose);
    copyVippsBtn?.addEventListener('click', handleCopyVipps);
    document.querySelectorAll('.settle-btn').forEach(btn => {
        btn.addEventListener('click', handleSettle);
    });
}

/**
 * Show reports modal
 */
export function showReportsModal() {
    const transactions = storage.getTransactions();
    const customers = storage.getAllCustomers();
    const today = storage.getTodayString();

    // Calculate stats
    const todayTransactions = transactions.filter(t => t.timestamp.startsWith(today));
    const revenue = todayTransactions.filter(t => t.type === 'purchase' || t.type === 'correction').reduce((sum, t) => sum + t.amount, 0);
    const paid = todayTransactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + t.amount, 0);
    const outstanding = customers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);

    // Product breakdown
    const productStats = {};
    todayTransactions.filter(t => t.type === 'purchase').forEach(t => {
        if (!productStats[t.productId]) {
            productStats[t.productId] = { name: t.productName, count: 0, total: 0 };
        }
        productStats[t.productId].count++;
        productStats[t.productId].total += t.amount;
    });

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">Rapporter - ${today}</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="modal-body reports-modal">
            <div class="report-section">
                <h4>Dagens oversikt</h4>
                <div class="report-stats">
                    <div class="report-stat">
                        <span class="report-stat-label">Omsatt</span>
                        <span class="report-stat-value">${formatCurrency(revenue)}</span>
                    </div>
                    <div class="report-stat">
                        <span class="report-stat-label">Betalt inn</span>
                        <span class="report-stat-value">${formatCurrency(paid)}</span>
                    </div>
                    <div class="report-stat">
                        <span class="report-stat-label">Utestående</span>
                        <span class="report-stat-value">${formatCurrency(outstanding)}</span>
                    </div>
                    <div class="report-stat">
                        <span class="report-stat-label">Transaksjoner</span>
                        <span class="report-stat-value">${todayTransactions.length}</span>
                    </div>
                </div>
            </div>

            <div class="report-section">
                <h4>Produkter solgt i dag</h4>
                ${Object.keys(productStats).length === 0 ? `
                    <p class="empty-state">Ingen salg i dag</p>
                ` : `
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Produkt</th>
                                <th>Antall</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.values(productStats).map(p => `
                                <tr>
                                    <td>${p.name}</td>
                                    <td>${p.count}</td>
                                    <td>${formatCurrency(p.total)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            </div>

            <div class="report-section">
                <h4>Kunder med saldo</h4>
                ${customers.filter(c => c.balance !== 0).length === 0 ? `
                    <p class="empty-state">Ingen kunder med utestående saldo</p>
                ` : `
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>Kunde</th>
                                <th>Saldo</th>
                                <th>Siste aktivitet</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${customers.filter(c => c.balance !== 0).map(c => {
                                const custTransactions = storage.getCustomerTransactions(c.id);
                                const lastActivity = custTransactions.length > 0 ? formatDateTime(custTransactions[0].timestamp) : '–';
                                return `
                                    <tr>
                                        <td>${c.name}${c.archived ? ' (arkivert)' : ''}</td>
                                        <td class="${c.balance > 0 ? 'positive' : 'negative'}">${formatCurrency(c.balance)}</td>
                                        <td>${lastActivity}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `}
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary modal-close-btn">Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = document.querySelector('.modal-close');
    const closeFooterBtn = document.querySelector('.modal-close-btn');

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    closeBtn?.addEventListener('click', handleClose);
    closeFooterBtn?.addEventListener('click', handleClose);
}

/**
 * Show customer history modal
 */
export function showHistoryModal(customer) {
    const transactions = storage.getCustomerTransactions(customer.id);

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">Historikk for ${customer.name}</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="modal-body history-modal">
            ${transactions.length === 0 ? `
                <p class="empty-state">Ingen transaksjoner</p>
            ` : `
                <div class="history-list">
                    ${transactions.map(t => `
                        <div class="history-item ${t.type} ${t.corrected ? 'corrected' : ''}">
                            <div class="history-main">
                                <span class="history-product">${t.productName}</span>
                                <span class="history-amount ${t.type === 'payment' ? 'payment' : ''}">${t.type === 'payment' ? '-' : ''}${formatCurrency(t.amount)}</span>
                            </div>
                            <div class="history-meta">
                                <span class="history-time">${formatDateTime(t.timestamp)}</span>
                                ${t.corrected ? '<span class="history-corrected">Korrigert</span>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
            <div class="history-summary">
                <div class="summary-item">
                    <span>Total kjøpt:</span>
                    <span>${formatCurrency(transactions.filter(t => t.type === 'purchase').reduce((sum, t) => sum + t.amount, 0))}</span>
                </div>
                <div class="summary-item">
                    <span>Total betalt:</span>
                    <span>${formatCurrency(transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + t.amount, 0))}</span>
                </div>
                <div class="summary-item total">
                    <span>Saldo:</span>
                    <span class="${customer.balance > 0 ? 'positive' : customer.balance < 0 ? 'negative' : 'zero'}">${formatCurrency(customer.balance)}</span>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary modal-close-btn">Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = document.querySelector('.modal-close');
    const closeFooterBtn = document.querySelector('.modal-close-btn');

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    closeBtn?.addEventListener('click', handleClose);
    closeFooterBtn?.addEventListener('click', handleClose);
}

/**
 * Show correction modal
 */
export function showCorrectionModal(customerId, transaction, onConfirm) {
    const customer = storage.getCustomer(customerId);
    if (!customer) return;

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">Korriger kjøp</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <form id="correction-form" class="modal-body">
            <div class="correction-current">
                <p><strong>Originalt:</strong> ${transaction.productName} - ${formatCurrency(transaction.amount)}</p>
                <p><strong>Tidspunkt:</strong> ${formatDateTime(transaction.timestamp)}</p>
            </div>

            <div class="form-group">
                <label for="correction-product">Nytt produkt</label>
                <select id="correction-product" name="productId" required>
                    ${DEFAULT_PRODUCTS.map(p => `
                        <option value="${p.id}" ${p.id === transaction.productId ? 'selected' : ''}>
                            ${p.name} ${p.price === 0 ? '(Gratis)' : `- ${formatCurrency(p.price)}`}${p.member ? ' [Medlem]' : ''}
                        </option>
                    `).join('')}
                </select>
            </div>

            <div class="form-group">
                <label for="correction-amount">Beløp</label>
                <input type="number" id="correction-amount" name="amount" required min="0" step="1" value="${transaction.amount}">
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary modal-cancel" type="button">Avbryt</button>
                <button class="btn btn-primary modal-submit" type="submit">Lagre endring</button>
            </div>
        </form>
    `;

    showModal(content);

    const form = document.getElementById('correction-form');
    const cancelBtn = document.querySelector('.modal-cancel');
    const closeBtn = document.querySelector('.modal-close');
    const productSelect = document.getElementById('correction-product');
    const amountInput = document.getElementById('correction-amount');

    // Update amount when product changes
    productSelect?.addEventListener('change', () => {
        const selectedProduct = DEFAULT_PRODUCTS.find(p => p.id === productSelect.value);
        if (selectedProduct) {
            amountInput.value = selectedProduct.price;
        }
    });

    const cleanup = () => {
        form?.removeEventListener('submit', handleSubmit);
        cancelBtn?.removeEventListener('click', handleCancel);
        closeBtn?.removeEventListener('click', handleCancel);
        productSelect?.removeEventListener('change', handleProductChange);
    };

    const handleProductChange = () => {
        const selectedProduct = DEFAULT_PRODUCTS.find(p => p.id === productSelect.value);
        if (selectedProduct) {
            amountInput.value = selectedProduct.price;
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const newProductId = productSelect.value;
        const newAmount = parseInt(amountInput.value, 10);

        if (isNaN(newAmount) || newAmount < 0) {
            showToast('Ugyldig beløp', 'error');
            return;
        }

        cleanup();
        closeModal();

        if (onConfirm) {
            onConfirm(newAmount, newProductId);
        }
    };

    const handleCancel = () => {
        cleanup();
        closeModal();
    };

    form?.addEventListener('submit', handleSubmit);
    cancelBtn?.addEventListener('click', handleCancel);
    closeBtn?.addEventListener('click', handleCancel);
}

/**
 * Show admin modal
 */
export function showAdminModal() {
    const settings = storage.getSettings();

    const content = `
        <div class="modal-header">
            <h3 id="modal-title">Admin panel</h3>
            <button class="modal-close" aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div class="modal-body admin-modal">
            <div class="admin-section">
                <h4>Innstillinger</h4>
                <form id="settings-form">
                    <div class="form-group">
                        <label for="admin-vipps">Vipps-nummer</label>
                        <input type="tel" id="admin-vipps" name="vippsNumber" value="${settings.vippsNumber || ''}" placeholder="Vipps-nummer">
                    </div>
                    <div class="form-group">
                        <label for="admin-password">Admin-passord</label>
                        <input type="password" id="admin-password" name="adminPassword" value="${settings.adminPassword || ''}" placeholder="Passord">
                    </div>
                    <button type="submit" class="btn btn-primary btn-sm">Lagre innstillinger</button>
                </form>
            </div>

            <div class="admin-section">
                <h4>Data</h4>
                <div class="admin-actions">
                    <button class="btn btn-secondary btn-sm" id="export-data">Eksporter all data</button>
                    <button class="btn btn-secondary btn-sm" id="import-data">Importer data</button>
                    <input type="file" id="import-file" accept=".json" style="display: none;">
                </div>
            </div>

            <div class="admin-section danger-zone">
                <h4>Farlig sone</h4>
                <button class="btn btn-danger btn-sm" id="clear-all-data">Slett ALL data</button>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary modal-close-btn">Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = document.querySelector('.modal-close');
    const closeFooterBtn = document.querySelector('.modal-close-btn');
    const settingsForm = document.getElementById('settings-form');
    const exportBtn = document.getElementById('export-data');
    const importBtn = document.getElementById('import-data');
    const importFile = document.getElementById('import-file');
    const clearBtn = document.getElementById('clear-all-data');

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
        settingsForm?.removeEventListener('submit', handleSettingsSubmit);
        exportBtn?.removeEventListener('click', handleExport);
        importBtn?.removeEventListener('click', () => importFile.click());
        importFile?.removeEventListener('change', handleImport);
        clearBtn?.removeEventListener('click', handleClear);
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    const handleSettingsSubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        const newSettings = {
            vippsNumber: formData.get('vippsNumber') || '',
            adminPassword: formData.get('adminPassword') || ''
        };
        storage.saveSettings(newSettings);
        showToast('Innstillinger lagret', 'success');
    };

    const handleExport = () => {
        const data = storage.exportAllData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bodenbar-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data eksportert', 'success');
    };

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                storage.importAllData(data);
                showToast('Data importert', 'success');
                refreshUI();
                closeModal();
            } catch {
                showToast('Ugyldig filformat', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleClear = () => {
        showConfirmModal(
            'Slett ALL data',
            'Dette vil slette ALLE kunder, transaksjoner og innstillinger. Denne handlingen kan ikke angres.',
            'danger',
            () => {
                storage.clearAllData();
                showToast('All data slettet', 'warning');
                refreshUI();
                closeModal();
            }
        );
    };

    closeBtn?.addEventListener('click', handleClose);
    closeFooterBtn?.addEventListener('click', handleClose);
    settingsForm?.addEventListener('submit', handleSettingsSubmit);
    exportBtn?.addEventListener('click', handleExport);
    importBtn?.addEventListener('click', () => importFile.click());
    importFile?.addEventListener('change', handleImport);
    clearBtn?.addEventListener('click', handleClear);
}