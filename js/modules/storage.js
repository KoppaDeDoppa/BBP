/** Cached authoritative state backed by the same-origin LAN API. */
const DEFAULT_PRODUCTS = [{
    id: 'beer',
    name: 'Øl',
    price: 50,
    icon: '🍺',
    member: false,
    fat: false
},
{
    id: 'whisky',
    name: 'Whisky',
    price: 100,
    icon: '🥃',
    member: false,
    fat: false
},
{
    id: 'fegisbubbler',
    name: 'Fegisbubbler',
    price: 25,
    icon: '🫧',
    member: false,
    fat: false
},
{
    id: 'beer-member',
    name: 'Øl til bryggerimedlem',
    price: 0,
    icon: '🍺',
    member: true,
    fat: false
},
{
    id: 'whisky-member',
    name: 'Whisky til bryggerimedlem',
    price: 0,
    icon: '🥃',
    member: true,
    fat: false
}
];
const DEFAULT_SETTINGS = {
    vippsNumber: '',
    theme: 'dark'
};
class Storage {
    constructor() {
        this.state = {
            customers: [],
            transactions: [],
            products: DEFAULT_PRODUCTS,
            settings: DEFAULT_SETTINGS,
            dailyStats: {}
        };
        this.revision = 0;
        this.user = null;
        this.ready = false;
    }
    async request(path, options = {}) {
        const response = await fetch(`/api${path}`, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
        const body = response.status === 204 ? null : await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || body?.message || `API-feil (${response.status})`);
        return body;
    }
    async loadState(since = null) {
        const result = await this.request(`/state${since == null ? '' : `?since=${encodeURIComponent(since)}`}`);
        if (!result.unchanged) {
            this.state = {
                ...this.state,
                ...result
            };
            this.revision = result.revision ?? this.revision;
        }
        this.ready = true;
        return result;
    }
    async init() {
        try {
            const session = await this.request('/auth/session');
            this.user = session.user || session;
            await this.loadState();
        } catch (error) {
            if (error.status !== 401) console.warn(error);
            this.user = null;
            this.ready = true;
        }
    }
    async login(username, password) {
        const result = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username,
                password
            })
        });
        this.user = result.user || result;
        await this.loadState();
        return this.user;
    }
    async logout() {
        await this.request('/auth/logout', {
            method: 'POST'
        });
        this.user = null;
        this.state = {
            customers: [],
            transactions: [],
            products: [],
            settings: {},
            dailyStats: {}
        };
    }
    getRole() {
        return this.user?.role || null;
    }
    isAdmin() {
        return this.getRole() === 'admin';
    }
    getCustomers(includeArchived = false) {
        const data = this.state.customers || [];
        return includeArchived ? data : data.filter(c => !c.archived);
    }
    getAllCustomers() {
        return this.getCustomers(true);
    }
    getCustomer(id) {
        return this.getAllCustomers().find(c => c.id === id) || null;
    }
    async addCustomer(name) {
        const result = await this.request('/customers', {
            method: 'POST',
            body: JSON.stringify({
                name: name.trim()
            })
        });
        await this.loadState(this.revision);
        return result.customer || result;
    }
    async updateCustomer(id, updates) {
        const c = await this.request(`/customers/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
        await this.loadState(this.revision);
        return c.customer || c;
    }
    async archiveCustomer(id) {
        return this.updateCustomer(id, {
            archived: true
        });
    }
    async unarchiveCustomer(id) {
        return this.updateCustomer(id, {
            archived: false
        });
    }
    async deleteCustomer(id) {
        await this.request(`/customers/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        await this.loadState(this.revision);
    }
    getTransactions() {
        return this.state.transactions || [];
    }
    getCustomerTransactions(id) {
        return this.getTransactions().filter(t => t.customerId === id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    getTodayString() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    }
    getTodayTransactions() {
        return this.getTransactions().filter(t => (t.timestamp || '').startsWith(this.getTodayString()));
    }
    async addTransaction(transaction) {
        let result;
        if (transaction.type === 'purchase') result = await this.request('/transactions/purchase', {
            method: 'POST',
            body: JSON.stringify(transaction)
        });
        else if (transaction.type === 'payment' || transaction.type === 'settlement') result = await this.request(`/transactions/settle/${encodeURIComponent(transaction.customerId)}`, {
            method: 'POST',
            body: JSON.stringify(transaction)
        });
        else result = await this.request('/transactions/purchase', {
            method: 'POST',
            body: JSON.stringify(transaction)
        });
        await this.loadState(this.revision);
        return result.transaction || result;
    }
    async removeLastTransaction(customerId) {
        const result = await this.request(`/transactions/undo/${encodeURIComponent(customerId)}`, {
            method: 'POST'
        });
        await this.loadState(this.revision);
        return result.transaction || result;
    }
    async correctTransaction(id, updates) {
        const result = await this.request(`/transactions/${encodeURIComponent(id)}/correct`, {
            method: 'POST',
            body: JSON.stringify(updates)
        });
        await this.loadState(this.revision);
        return result.transaction || result;
    }
    getDailyStats() {
        return this.state.dailyStats || {};
    }
    updateDailyStats() {
        return this.getDailyStats();
    }
    checkDailyReset() {
        return this.getDailyStats();
    }
    getSettings() {
        return {
            ...DEFAULT_SETTINGS,
            ...(this.state.settings || {})
        };
    }
    async saveSettings(settings) {
        const result = await this.request('/settings', {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        await this.loadState(this.revision);
        return result;
    }
    getProducts() {
        return this.state.products || [];
    }
    getProduct(id) {
        return this.getProducts().find(p => p.id === id) || null;
    }
    async addProduct(product) {
        const result = await this.request('/products', {
            method: 'POST',
            body: JSON.stringify(product)
        });
        await this.loadState(this.revision);
        return result.product || result;
    }
    async updateProduct(id, updates) {
        const result = await this.request(`/products/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        await this.loadState(this.revision);
        return result.product || result;
    }
    async removeProduct(id) {
        await this.request(`/products/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        await this.loadState(this.revision);
        return true;
    }
    hasMadePayment(id) {
        return this.getCustomerTransactions(id).some(t => t.type === 'payment');
    }
    exportAllData() {
        return {
            version: 2,
            exportDate: new Date().toISOString(),
            ...this.state
        };
    }
    async importAllData(data) {
        await this.request('/admin/restore', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        await this.loadState();
    }
    async clearAllData() {
        await this.request('/admin/clear', {
            method: 'POST'
        });
        await this.loadState();
    }
}
export const storage = new Storage();
export {
    DEFAULT_PRODUCTS,
    DEFAULT_SETTINGS
};
