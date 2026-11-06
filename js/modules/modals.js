/**
 * Modals Module - Handles all modal dialogs
 * BodenBar - Unstyled foundation
 */

import { storage } from './storage.js';
import { formatCurrency, formatDateTime, showToast, setButtonLoading } from './ui.js';
import { refreshUI } from '../app.js';
import { setActiveCustomerId } from './state.js';

// Modal state
let currentModal = null;

function escapeHtml(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

/**
 * Show a modal with custom content
 */
export function showModal(content) {
    const container = document.getElementById('modals-container');
    if (!container) return;

    const modalHtml = `
        <div data-modal-overlay role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div data-modal>
                ${content}
            </div>
        </div>
    `;

    container.innerHTML = modalHtml;
    currentModal = container.querySelector('[data-modal-overlay]');
    container.setAttribute('aria-hidden', 'false');

    // Show modal (no animation without CSS)
    currentModal.hidden = false;

    // Focus management
    const modalForFocus = currentModal;
    requestAnimationFrame(() => {
        if (!modalForFocus.isConnected) return;
        const formField = modalForFocus.querySelector('input, select, textarea');
        if (formField) {
            formField.focus();
        } else {
            const focusable = modalForFocus.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
            if (focusable) focusable.focus();
        }
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

    const overlay = container.querySelector('[data-modal-overlay]');
    if (overlay) {
        overlay.removeEventListener('keydown', trapFocus);
        container.innerHTML = '';
        currentModal = null;
    } else {
        container.innerHTML = '';
        currentModal = null;
    }
    container.setAttribute('aria-hidden', 'true');
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
export function showConfirmModal(title, message, type = 'warning', onConfirm, onCancel) {
    const typeIcons = {
        warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    const content = `
        <div>
            <div>${typeIcons[type] || typeIcons.warning}</div>
            <h3 id="modal-title">${title}</h3>
        </div>
        <div>
            <p>${message}</p>
        </div>
        <div>
            <button data-modal-cancel>Avbryt</button>
            <button data-modal-confirm>${type === 'danger' ? 'Slett' : 'Bekreft'}</button>
        </div>
    `;

    showModal(content);

    const confirmBtn = currentModal.querySelector('[data-modal-confirm]');
    const cancelBtn = currentModal.querySelector('[data-modal-cancel]');

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
        onCancel?.();
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
        <div>
            <h3 id="modal-title">${title}</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <form id="customer-form">
            <div>
                <label for="customer-name-input">Navn</label>
                <input type="text" id="customer-name-input" name="name" required value="${customer?.name || ''}" placeholder="Kundenavn" autocomplete="name">
            </div>
            ${isEdit ? `
            <div>
                <label>Saldo</label>
                <div>${formatCurrency(customer.balance)}</div>
            </div>
            ` : ''}
            <div>
                <button type="button" data-modal-cancel>Avbryt</button>
                <button type="submit" data-modal-submit>${isEdit ? 'Lagre' : 'Legg til'}</button>
            </div>
        </form>
    `;

    showModal(content);

    const form = document.getElementById('customer-form');
    const cancelBtn = currentModal.querySelector('[data-modal-cancel]');
    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');

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
        <div>
            <h3 id="modal-title">Oppgjør</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div>
            ${customers.length === 0 ? `
                <p>Ingen kunder med utestående saldo</p>
            ` : `
                <div>
                    ${customers.map(c => `
                        <div data-customer-id="${c.id}">
                            <div>
                                <span>${c.name}</span>
                                <span>${formatCurrency(c.balance)}</span>
                            </div>
                            <button data-customer-id="${c.id}" ${c.balance === 0 ? 'disabled' : ''}>
                                ${c.balance > 0 ? 'Registrer betaling' : 'Gjenopptak'}
                            </button>
                        </div>
                    `).join('')}
                </div>
            `}
            <div>
                <h4>Vipps</h4>
                <div>${settings.vippsNumber || 'Ikke konfigurert'}</div>
                <button id="copy-vipps">Kopier Vipps-nummer</button>
            </div>
        </div>
        <div>
            <button data-modal-close>Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const closeFooterBtn = currentModal.querySelector('[data-modal-close]');
    const copyVippsBtn = document.getElementById('copy-vipps');

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
        copyVippsBtn?.removeEventListener('click', handleCopyVipps);
        currentModal.querySelectorAll('[data-customer-id] button').forEach(btn => {
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
    currentModal.querySelectorAll('[data-customer-id] button').forEach(btn => {
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
        <div>
            <h3 id="modal-title">Rapporter - ${today}</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div>
            <div>
                <h4>Dagens oversikt</h4>
                <div>
                    <div>
                        <span>Omsatt</span>
                        <span>${formatCurrency(revenue)}</span>
                    </div>
                    <div>
                        <span>Betalt inn</span>
                        <span>${formatCurrency(paid)}</span>
                    </div>
                    <div>
                        <span>Utestående</span>
                        <span>${formatCurrency(outstanding)}</span>
                    </div>
                    <div>
                        <span>Transaksjoner</span>
                        <span>${todayTransactions.length}</span>
                    </div>
                </div>
            </div>

            <div>
                <h4>Produkter solgt i dag</h4>
                ${Object.keys(productStats).length === 0 ? `
                    <p>Ingen salg i dag</p>
                ` : `
                    <table>
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

            <div>
                <h4>Kunder med saldo</h4>
                ${customers.filter(c => c.balance !== 0).length === 0 ? `
                    <p>Ingen kunder med utestående saldo</p>
                ` : `
                    <table>
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
                                        <td>${formatCurrency(c.balance)}</td>
                                        <td>${lastActivity}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `}
            </div>
        </div>
        <div>
            <button data-modal-close>Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const closeFooterBtn = currentModal.querySelector('[data-modal-close]');

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
        <div>
            <h3 id="modal-title">Historikk for ${customer.name}</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div>
            ${transactions.length === 0 ? `
                <p>Ingen transaksjoner</p>
            ` : `
                <div>
                    ${transactions.map(t => `
                        <div>
                            <div>
                                <span>${t.productName}</span>
                                <span>${t.type === 'payment' ? '-' : ''}${formatCurrency(t.amount)}</span>
                            </div>
                            <div>
                                <span>${formatDateTime(t.timestamp)}</span>
                                ${t.corrected ? '<span>Korrigert</span>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
            <div>
                <div>
                    <span>Total kjøpt:</span>
                    <span>${formatCurrency(transactions.filter(t => t.type === 'purchase').reduce((sum, t) => sum + t.amount, 0))}</span>
                </div>
                <div>
                    <span>Total betalt:</span>
                    <span>${formatCurrency(transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + t.amount, 0))}</span>
                </div>
                <div>
                    <span>Saldo:</span>
                    <span>${formatCurrency(customer.balance)}</span>
                </div>
            </div>
        </div>
        <div>
            <button data-modal-close>Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const closeFooterBtn = currentModal.querySelector('[data-modal-close]');

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
        <div>
            <h3 id="modal-title">Korriger kjøp</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <form id="correction-form">
            <div>
                <p><strong>Originalt:</strong> ${transaction.productName} - ${formatCurrency(transaction.amount)}</p>
                <p><strong>Tidspunkt:</strong> ${formatDateTime(transaction.timestamp)}</p>
            </div>

            <div>
                <label for="correction-product">Nytt produkt</label>
                <select id="correction-product" name="productId" required>
                    ${storage.getProducts().map(p => `
                        <option value="${escapeHtml(p.id)}" ${p.id === transaction.productId ? 'selected' : ''}>
                            ${escapeHtml(p.name)} ${p.price === 0 ? '(Gratis)' : `- ${formatCurrency(p.price)}`}${p.member ? ' [Medlem]' : ''}
                        </option>
                    `).join('')}
                </select>
            </div>

            <div>
                <label for="correction-amount">Beløp</label>
                <input type="number" id="correction-amount" name="amount" required min="0" step="1" value="${transaction.amount}">
            </div>

            <div>
                <button type="button" data-modal-cancel>Avbryt</button>
                <button type="submit" data-modal-submit>Lagre endring</button>
            </div>
        </form>
    `;

    showModal(content);

    const form = document.getElementById('correction-form');
    const cancelBtn = currentModal.querySelector('[data-modal-cancel]');
    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const productSelect = document.getElementById('correction-product');
    const amountInput = document.getElementById('correction-amount');

    // Update amount when product changes
    productSelect?.addEventListener('change', handleProductChange);

    const cleanup = () => {
        form?.removeEventListener('submit', handleSubmit);
        cancelBtn?.removeEventListener('click', handleCancel);
        closeBtn?.removeEventListener('click', handleCancel);
        productSelect?.removeEventListener('change', handleProductChange);
    };

    const handleProductChange = () => {
        const selectedProduct = storage.getProduct(productSelect.value);
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

function renderAdminProductRows() {
    const transactions = storage.getTransactions();
    return storage.getProducts().map(product => {
        const hasHistory = transactions.some(transaction => transaction.productId === product.id);
        return `
            <form class="admin-product-row" data-product-form data-product-id="${escapeHtml(product.id)}">
                <div class="admin-product-fields">
                    <label>Ikon
                        <input name="icon" type="text" required maxlength="8" value="${escapeHtml(product.icon)}" aria-label="Ikon for ${escapeHtml(product.name)}">
                    </label>
                    <label>Produktnavn
                        <input name="name" type="text" required maxlength="60" value="${escapeHtml(product.name)}" aria-label="Navn på ${escapeHtml(product.name)}">
                    </label>
                    <label>Pris (kr)
                        <input name="price" type="number" required min="0" step="1" value="${product.price}" aria-label="Pris for ${escapeHtml(product.name)}">
                    </label>
                </div>
                <div class="admin-product-actions">
                    <label class="admin-member-toggle">
                        <input name="member" type="checkbox" ${product.member ? 'checked' : ''}>
                        Medlemsprodukt
                    </label>
                    <button type="submit">Lagre</button>
                    <button type="button" data-remove-product="${escapeHtml(product.id)}" ${hasHistory ? 'disabled title="Produktet er brukt i transaksjonshistorikk"' : ''}>Fjern</button>
                    ${hasHistory ? '<span class="admin-product-note">I bruk i historikk – kan ikke fjernes</span>' : ''}
                </div>
            </form>
        `;
    }).join('');
}

/**
 * Show admin modal
 */
export function showAdminModal() {
    const settings = storage.getSettings();

    const content = `
        <div>
            <h3 id="modal-title">Admin panel</h3>
            <button aria-label="Lukk">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
        <div>
            <div>
                <h4>Innstillinger</h4>
                <form id="settings-form">
                    <div>
                        <label for="admin-vipps">Vipps-nummer</label>
                        <input type="tel" id="admin-vipps" name="vippsNumber" value="${settings.vippsNumber || ''}" placeholder="Vipps-nummer">
                    </div>
                    <button type="submit">Lagre innstillinger</button>
                </form>
            </div>

            <section class="admin-products-section" aria-labelledby="admin-products-heading">
                <h4 id="admin-products-heading">Produktmeny</h4>
                <p>Endre navn, pris og ikon på produktene som vises i kassen. Tidligere transaksjoner beholder sine lagrede detaljer.</p>
                <div id="admin-product-list" aria-label="Produkter">${renderAdminProductRows()}</div>
                <form id="admin-add-product-form" class="admin-add-product-form">
                    <h5>Legg til produkt</h5>
                    <div class="admin-product-fields">
                        <label>Ikon
                            <input name="icon" type="text" required maxlength="8" value="🍷" aria-label="Ikon for nytt produkt">
                        </label>
                        <label>Produktnavn
                            <input name="name" type="text" required maxlength="60" placeholder="For eksempel Vin">
                        </label>
                        <label>Pris (kr)
                            <input name="price" type="number" required min="0" step="1" value="0">
                        </label>
                    </div>
                    <div class="admin-product-actions">
                        <label class="admin-member-toggle"><input name="member" type="checkbox"> Medlemsprodukt</label>
                        <button type="submit">Legg til produkt</button>
                    </div>
                </form>
            </section>

            <div>
                <h4>Data</h4>
                <div>
                    <button id="export-data">Eksporter all data</button>
                    <button id="import-data">Importer data</button>
                    <input type="file" id="import-file" accept=".json" hidden>
                </div>
            </div>

            <div>
                <h4>Farlig sone</h4>
                <button id="clear-all-data">Slett ALL data</button>
            </div>
        </div>
        <div>
            <button data-modal-close>Lukk</button>
        </div>
    `;

    showModal(content);

    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const closeFooterBtn = currentModal.querySelector('[data-modal-close]');
    const settingsForm = document.getElementById('settings-form');
    const exportBtn = document.getElementById('export-data');
    const importBtn = document.getElementById('import-data');
    const importFile = document.getElementById('import-file');
    const clearBtn = document.getElementById('clear-all-data');
    const productList = document.getElementById('admin-product-list');
    const addProductForm = document.getElementById('admin-add-product-form');
    const handleImportOpen = () => importFile.click();

    const readProductForm = (form) => {
        const formData = new FormData(form);
        const rawPrice = formData.get('price');
        return {
            name: String(formData.get('name') || '').trim(),
            price: rawPrice === '' ? NaN : Number(rawPrice),
            icon: String(formData.get('icon') || '').trim(),
            member: form.elements.member.checked
        };
    };

    const handleProductSave = (e) => {
        const form = e.target.closest('[data-product-form]');
        if (!form) return;
        e.preventDefault();
        if (!form.reportValidity()) return;
        try {
            const product = storage.updateProduct(form.dataset.productId, readProductForm(form));
            if (!product) throw new Error('Fant ikke produktet.');
            refreshUI();
            showToast(`${product.name} oppdatert`, 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke lagre produktet', 'error');
        }
    };

    const handleAddProduct = (e) => {
        e.preventDefault();
        if (!addProductForm.reportValidity()) return;
        try {
            const product = storage.addProduct(readProductForm(addProductForm));
            productList.innerHTML = renderAdminProductRows();
            addProductForm.reset();
            refreshUI();
            showToast(`${product.name} lagt til`, 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke legge til produktet', 'error');
        }
    };

    const handleProductRemove = (e) => {
        const button = e.target.closest('[data-remove-product]');
        if (!button || button.disabled) return;
        const product = storage.getProduct(button.dataset.removeProduct);
        if (!product) return;
        showConfirmModal(
            'Fjern produkt',
            `Vil du fjerne <strong>${escapeHtml(product.name)}</strong> fra menyen?`,
            'danger',
            () => {
                if (!storage.removeProduct(product.id)) {
                    showToast('Produktet er brukt i historikk og kan ikke fjernes', 'warning');
                } else {
                    showToast(`${product.name} fjernet fra menyen`, 'success');
                }
                refreshUI();
                showAdminModal();
            },
            () => showAdminModal()
        );
    };

    const cleanup = () => {
        closeBtn?.removeEventListener('click', handleClose);
        closeFooterBtn?.removeEventListener('click', handleClose);
        settingsForm?.removeEventListener('submit', handleSettingsSubmit);
        exportBtn?.removeEventListener('click', handleExport);
        importBtn?.removeEventListener('click', handleImportOpen);
        importFile?.removeEventListener('change', handleImport);
        clearBtn?.removeEventListener('click', handleClear);
        productList?.removeEventListener('submit', handleProductSave);
        productList?.removeEventListener('click', handleProductRemove);
        addProductForm?.removeEventListener('submit', handleAddProduct);
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    const handleSettingsSubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        const newSettings = { vippsNumber: formData.get('vippsNumber') || '' };
        storage.saveSettings(newSettings).then(() => showToast('Innstillinger lagret', 'success')).catch(error => showToast(error.message, 'error'));
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
            } catch (error) {
                showToast(error.message || 'Ugyldig filformat', 'error');
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
    importBtn?.addEventListener('click', handleImportOpen);
    importFile?.addEventListener('change', handleImport);
    clearBtn?.addEventListener('click', handleClear);
    productList?.addEventListener('submit', handleProductSave);
    productList?.addEventListener('click', handleProductRemove);
    addProductForm?.addEventListener('submit', handleAddProduct);
}