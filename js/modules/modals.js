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
export function showModal(content, { focusForm = true } = {}) {
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
        const formField = focusForm && modalForFocus.querySelector('input, select, textarea');
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('customer-name-input');
        const submitButton = form?.querySelector('[data-modal-submit]');
        const name = nameInput?.value?.trim();

        if (!name) {
            showToast('Navn er påkrevd', 'error');
            nameInput?.focus();
            return;
        }

        if (submitButton) submitButton.disabled = true;
        try {
            if (isEdit) {
                await storage.updateCustomer(customer.id, { name });
            } else {
                const newCustomer = await storage.addCustomer(name);
                setActiveCustomerId(newCustomer.id);
            }
            cleanup();
            closeModal();
            refreshUI({ mobileView: isEdit ? undefined : 'products' });
            showToast(`${name} ${isEdit ? 'oppdatert' : 'lagt til'}`, 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke lagre kunden', 'error');
        } finally {
            if (submitButton) submitButton.disabled = false;
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

    const handleSettle = async (e) => {
        const customerId = e.target.dataset.customerId;
        const customer = storage.getCustomer(customerId);
        if (!customer) return;

        try {
            if (customer.balance > 0) {
                // Register payment
                await storage.addTransaction({
                    customerId,
                    type: 'payment',
                    amount: customer.balance,
                    productId: 'payment',
                    productName: 'Betaling',
                    price: customer.balance
                });
                await storage.updateCustomer(customerId, { balance: 0 });
                showToast(`Betaling registrert for ${customer.name}`, 'success');
            } else {
                // Credit back (negative balance)
                await storage.addTransaction({
                    customerId,
                    type: 'correction',
                    amount: -customer.balance,
                    productId: 'credit',
                    productName: 'Gjenopptak',
                    price: -customer.balance
                });
                await storage.updateCustomer(customerId, { balance: 0 });
                showToast(`Gjenopptak registrert for ${customer.name}`, 'success');
            }

            cleanup();
            closeModal();
            refreshUI();
        } catch (error) {
            showToast(error.message || 'Kunne ikke registrere oppgjør', 'error');
        }
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
                            ${escapeHtml(p.name)} ${p.price === 0 ? '(Gratis)' : `- ${formatCurrency(p.price)}`}${p.member ? ' [Medlem]' : ''}${p.fat ? ' [Fat]' : ''}
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

    productSelect?.addEventListener('change', handleProductChange);
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
                    <label>Ikon (valgfritt)
                        <input name="icon" type="text" maxlength="8" value="${escapeHtml(product.icon)}" aria-label="Ikon for ${escapeHtml(product.name)}" placeholder="Emoji eller ikon">
                    </label>
                    <label>Produktnavn
                        <input name="name" type="text" required maxlength="60" value="${escapeHtml(product.name)}" aria-label="Navn på ${escapeHtml(product.name)}">
                    </label>
                    <label>Pris (kr)
                        <input name="price" type="number" required min="0" step="1" value="${product.price}" aria-label="Pris for ${escapeHtml(product.name)}">
                    </label>
                </div>
                <div class="admin-product-actions">
                    <div class="admin-product-toggles">
                        <label class="admin-member-toggle">
                            <input name="member" type="checkbox" ${product.member ? 'checked' : ''}>
                            Medlemsprodukt
                        </label>
                        <label class="admin-member-toggle">
                            <input name="fat" type="checkbox" ${product.fat ? 'checked' : ''}>
                            Fat
                        </label>
                    </div>
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
export function showEstimatedKegModal(draft = null) {
    const keg = storage.getEstimatedKeg();
    const configuration = draft || {
        enabled: keg.enabled, capacityLitres: keg.capacityMl ? keg.capacityMl / 1000 : '',
        productIds: keg.productIds || []
    };
    const selected = new Set(configuration.productIds);
    const products = storage.getProducts();
    const summary = keg.capacityMl
        ? `${(keg.remainingMl / 1000).toFixed(1)} L av ${(keg.capacityMl / 1000).toFixed(1)} L igjen (anslag).`
        : 'Velg produkter og angi kapasitet og nåværende volum for å starte.';
    showModal(`
        <div>
            <h3 id="modal-title">Fat uten vekt</h3>
            <button aria-label="Lukk">×</button>
        </div>
        <form id="estimated-keg-form" class="estimated-keg-form">
            <p role="status">${escapeHtml(summary)}</p>
            <p>Hvert kjøp av et valgt produkt trekker 0,5 L, også gratis medlemsserveringer. Angring legger volumet tilbake. Søl og uregistrerte serveringer må justeres manuelt.</p>
            <label class="admin-member-toggle"><input type="checkbox" name="enabled" ${configuration.enabled ? 'checked' : ''}> Aktiver beregning</label>
            <div class="keg-volume-fields">
                <label for="keg-capacity">Fatets kapasitet (L)
                    <input id="keg-capacity" name="capacityLitres" type="number" min="0.001" max="10000" step="0.001" inputmode="decimal" value="${escapeHtml(configuration.capacityLitres)}" placeholder="For eksempel 30">
                </label>
                <label for="keg-current">Sett gjenværende volum (L)
                    <input id="keg-current" name="currentLitres" type="number" min="0" max="10000" step="0.001" inputmode="decimal" value="${escapeHtml(configuration.currentLitres ?? '')}" placeholder="${keg.capacityMl ? 'Tomt felt beholder anslaget' : 'Påkrevd ved første oppsett'}" aria-describedby="keg-calibration-note">
                </label>
            </div>
            <p id="keg-calibration-note">Et nytt volum starter en ny beregning. Angring av tidligere kjøp endrer da ikke dette volumet.</p>
            <fieldset class="keg-product-selection">
                <legend>Produkter som serveres fra dette fatet</legend>
                ${products.map(product => `<label class="admin-member-toggle"><input type="checkbox" name="productId" value="${escapeHtml(product.id)}" ${selected.has(product.id) ? 'checked' : ''}> <span>${escapeHtml(product.name)}${product.member ? ' (medlem)' : ''}</span></label>`).join('') || '<p>Legg til et produkt i adminpanelet først.</p>'}
            </fieldset>
            <p id="keg-form-error" class="keg-form-error" role="alert" hidden></p>
            <div class="keg-form-actions">
                <button type="submit">Lagre fatinnstillinger</button>
                <button type="button" id="keg-reset" ${!keg.enabled || !keg.cycleId ? 'disabled' : ''}>Koble til nytt, fullt fat</button>
            </div>
        </form>
        <div><button id="keg-back">Tilbake til admin</button></div>
    `, { focusForm: false });

    const form = document.getElementById('estimated-keg-form');
    const errorEl = document.getElementById('keg-form-error');
    const reportError = error => {
        errorEl.textContent = error.message || 'Kunne ikke lagre fatinnstillinger.';
        errorEl.hidden = false;
    };
    const save = async payload => {
        // The form may have been replaced by a confirmation modal.
        const activeForm = document.getElementById('estimated-keg-form');
        if (activeForm?.dataset.pending === 'true') return;
        if (activeForm) {
            activeForm.dataset.pending = 'true';
            activeForm.querySelectorAll('button').forEach(button => { button.disabled = true; });
        }
        try {
            await storage.saveEstimatedKeg(payload);
            refreshUI();
            showEstimatedKegModal();
            showToast('Fatinnstillinger lagret', 'success');
        } catch (error) {
            showEstimatedKegModal(payload);
            const message = document.getElementById('keg-form-error');
            message.textContent = error.message || 'Kunne ikke lagre fatinnstillinger.';
            message.hidden = false;
        }
    };
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (form.dataset.pending === 'true' || !form.reportValidity()) return;
        const data = new FormData(form);
        const payload = {
            enabled: form.elements.enabled.checked,
            capacityLitres: Number(data.get('capacityLitres')),
            productIds: data.getAll('productId')
        };
        const current = String(data.get('currentLitres')).trim();
        if (current !== '') payload.currentLitres = Number(current);
        if (payload.enabled && (!payload.capacityLitres || !payload.productIds.length || (!keg.capacityMl && current === ''))) {
            reportError(new Error('Velg minst ett produkt og angi kapasitet. Første oppsett krever også gjenværende volum.'));
            return;
        }
        if (current !== '' && (payload.currentLitres < 0 || payload.currentLitres > payload.capacityLitres)) {
            reportError(new Error('Gjenværende volum må være mellom 0 og fatets kapasitet.'));
            return;
        }
        if (current !== '' && keg.capacityMl) {
            showConfirmModal('Sett gjenværende volum', 'Dette starter en ny beregning. Angring eller retting av eldre kjøp vil ikke endre det nye volumet.', 'warning',
                () => { showEstimatedKegModal(payload); save(payload); }, () => showEstimatedKegModal(payload));
        } else save(payload);
    });
    document.getElementById('keg-reset').addEventListener('click', () => {
        if (form.dataset.pending === 'true') return;
        showConfirmModal('Koble til nytt, fullt fat', `Sett anslaget til ${(keg.capacityMl / 1000).toFixed(1)} L? Kjøp fra det forrige fatet vil ikke endre det nye fatet. Eventuelle ulagrede skjemaendringer brukes ikke.`, 'warning', async () => {
            showEstimatedKegModal();
            const currentForm = document.getElementById('estimated-keg-form');
            currentForm.dataset.pending = 'true';
            currentForm.querySelectorAll('button').forEach(button => { button.disabled = true; });
            try {
                await storage.resetEstimatedKeg();
                refreshUI();
                showEstimatedKegModal();
                showToast('Nytt fat tilkoblet', 'success');
            } catch (error) {
                showEstimatedKegModal();
                const message = document.getElementById('keg-form-error');
                message.textContent = error.message;
                message.hidden = false;
            }
        }, () => showEstimatedKegModal());
    });
    document.getElementById('keg-back').addEventListener('click', () => showAdminModal());
    currentModal.querySelector('[aria-label="Lukk"]').addEventListener('click', closeModal);
}

export function showAdminModal() {
    const settings = storage.getSettings();
    const keg = storage.getEstimatedKeg();

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

            <section class="admin-keg-section" aria-labelledby="admin-keg-heading">
                <h4 id="admin-keg-heading">Fat uten vekt</h4>
                <p>${keg.enabled ? `Anslått ${escapeHtml((keg.remainingMl / 1000).toFixed(1))} L igjen. Hver registrerte servering trekker 0,5 L.` : 'Ikke aktivert. Beregn gjenværende øl fra registrerte serveringer.'}</p>
                <button id="manage-estimated-keg">Administrer fat uten vekt</button>
            </section>

            <section class="admin-products-section" aria-labelledby="admin-products-heading">
                <h4 id="admin-products-heading">Produktmeny</h4>
                <p>Endre navn, pris og ikon på produktene som vises i kassen. Lag egne produkter for fat og boks. Endrer du Fat på et produkt som er brukt, endres også merkingen i kundenes varetelling.</p>
                <div id="admin-product-list" aria-label="Produkter">${renderAdminProductRows()}</div>
                <form id="admin-add-product-form" class="admin-add-product-form">
                    <h5>Legg til produkt</h5>
                    <div class="admin-product-fields">
                        <label>Ikon (valgfritt)
                            <input name="icon" type="text" maxlength="8" value="🍷" aria-label="Ikon for nytt produkt" placeholder="Emoji eller ikon">
                        </label>
                        <label>Produktnavn
                            <input name="name" type="text" required maxlength="60" placeholder="For eksempel Vin">
                        </label>
                        <label>Pris (kr)
                            <input name="price" type="number" required min="0" step="1" value="0">
                        </label>
                    </div>
                    <div class="admin-product-actions">
                        <div class="admin-product-toggles">
                            <label class="admin-member-toggle"><input name="member" type="checkbox"> Medlemsprodukt</label>
                            <label class="admin-member-toggle"><input name="fat" type="checkbox"> Fat</label>
                        </div>
                        <button type="submit">Legg til produkt</button>
                    </div>
                </form>
            </section>

            <div>
                <h4>Salgsrapport</h4>
                <p>Last ned en oversikt over salg og serveringer de siste 30 dagene, inkludert i dag.</p>
                <button id="download-sales-report">Last ned salgsrapport (siste 30 dager)</button>
            </div>

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

    showModal(content, { focusForm: false });

    const closeBtn = currentModal.querySelector('[aria-label="Lukk"]');
    const closeFooterBtn = currentModal.querySelector('[data-modal-close]');
    const settingsForm = document.getElementById('settings-form');
    const reportBtn = document.getElementById('download-sales-report');
    const manageKegBtn = document.getElementById('manage-estimated-keg');
    const handleManageKeg = () => { cleanup(); showEstimatedKegModal(); };
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
            member: form.elements.member.checked,
            fat: form.elements.fat.checked
        };
    };

    const handleProductSave = async (e) => {
        const form = e.target.closest('[data-product-form]');
        if (!form) return;
        e.preventDefault();
        if (!form.reportValidity()) return;
        try {
            const product = await storage.updateProduct(form.dataset.productId, readProductForm(form));
            if (!product) throw new Error('Fant ikke produktet.');
            refreshUI();
            showToast(`${product.name} oppdatert`, 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke lagre produktet', 'error');
        }
    };

    const handleAddProduct = async (e) => {
        e.preventDefault();
        if (!addProductForm.reportValidity()) return;
        try {
            const product = await storage.addProduct(readProductForm(addProductForm));
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
            async () => {
                try {
                    const removed = await storage.removeProduct(product.id);
                    if (!removed) {
                        showToast('Produktet er brukt i historikk og kan ikke fjernes', 'warning');
                    } else {
                        showToast(`${product.name} fjernet fra menyen`, 'success');
                    }
                    refreshUI();
                    showAdminModal();
                } catch (error) {
                    showToast(error.message || 'Kunne ikke fjerne produktet', 'error');
                    showAdminModal();
                }
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
        reportBtn?.removeEventListener('click', handleDownloadSalesReport);
        manageKegBtn?.removeEventListener('click', handleManageKeg);
    };

    const handleClose = () => {
        cleanup();
        closeModal();
    };

    const handleSettingsSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        const newSettings = { vippsNumber: formData.get('vippsNumber') || '' };
        try {
            await storage.saveSettings(newSettings);
            showToast('Innstillinger lagret', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        }
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
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                showConfirmModal('Importer sikkerhetskopi',
                    data.version === 3
                        ? 'Dette erstatter kunder, produkter og historikk, og gjenoppretter også fatets lagrede volumanslag. Volumet i sikkerhetskopien kan avvike fra det som er igjen nå.'
                        : 'Dette erstatter kunder, produkter og historikk. Nåværende fatvolum beholdes; importerte kjøp endrer ikke volumet. Kontroller produktkoblingene etter import.',
                    'warning', async () => {
                        try {
                            await storage.importAllData(data);
                            showToast('Data importert', 'success');
                            refreshUI();
                        } catch (error) {
                            showToast(error.message || 'Kunne ikke importere data', 'error');
                        }
                        showAdminModal();
                    }, () => showAdminModal());
            } catch (error) {
                showToast(error.message || 'Ugyldig filformat', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleDownloadSalesReport = async () => {
        reportBtn.disabled = true;
        reportBtn.textContent = 'Lager rapport…';
        try {
            const blob = await storage.downloadSalesReport();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bodenbar-salgsrapport-${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Salgsrapport lastet ned', 'success');
        } catch (error) {
            showToast(error.message || 'Kunne ikke lage salgsrapport', 'error');
        } finally {
            reportBtn.disabled = false;
            reportBtn.textContent = 'Last ned salgsrapport (siste 30 dager)';
        }
    };

    const handleClear = () => {
        showConfirmModal(
            'Slett ALL data',
            'Dette vil slette ALLE kunder, transaksjoner, produkter og vanlige innstillinger. Fatets gjenværende volum beholdes, men produktkoblinger som ikke lenger finnes, fjernes. Denne handlingen kan ikke angres.',
            'danger',
            async () => {
                try {
                    await storage.clearAllData();
                    showToast('All data slettet', 'warning');
                    refreshUI();
                    closeModal();
                } catch (error) {
                    showToast(error.message || 'Kunne ikke slette data', 'error');
                }
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
    reportBtn?.addEventListener('click', handleDownloadSalesReport);
    manageKegBtn?.addEventListener('click', handleManageKeg);
}