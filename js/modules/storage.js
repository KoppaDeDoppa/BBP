/**
 * Storage Module - Handles localStorage persistence
 * BodenBar v1.4
 */

const STORAGE_KEYS = {
    CUSTOMERS: 'bodenbar_customers',
    TRANSACTIONS: 'bodenbar_transactions',
    SETTINGS: 'bodenbar_settings',
    DAILY_STATS: 'bodenbar_daily_stats',
    LAST_DATE: 'bodenbar_last_date'
};

const DEFAULT_PRODUCTS = [
    { id: 'beer', name: 'Øl', price: 50, icon: '🍺', member: false },
    { id: 'whisky', name: 'Whisky', price: 100, icon: '🥃', member: false },
    { id: 'fegisbubbler', name: 'Fegisbubbler', price: 25, icon: '🫧', member: false },
    { id: 'beer-member', name: 'Øl til bryggerimedlem', price: 0, icon: '🍺', member: true },
    { id: 'whisky-member', name: 'Whisky til bryggerimedlem', price: 0, icon: '🥃', member: true }
];

const DEFAULT_SETTINGS = {
    vippsNumber: '1234567890',
    adminPassword: 'admin',
    theme: 'dark'
};

class Storage {
    constructor() {
        this.init();
    }

    init() {
        // Check and migrate old data if needed
        this.migrateIfNeeded();

        // Initialize default data if empty
        if (!localStorage.getItem(STORAGE_KEYS.CUSTOMERS)) {
            this.saveCustomers([]);
        }
        if (!localStorage.getItem(STORAGE_KEYS.TRANSACTIONS)) {
            this.saveTransactions([]);
        }
        if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
            this.saveSettings(DEFAULT_SETTINGS);
        }

        // Check for date change (new day)
        this.checkDailyReset();
    }

    migrateIfNeeded() {
        // Handle any migrations from older versions
        const version = localStorage.getItem('bodenbar_version');
        if (!version) {
            localStorage.setItem('bodenbar_version', '1.4');
        }
    }

    checkDailyReset() {
        const today = this.getTodayString();
        const lastDate = localStorage.getItem(STORAGE_KEYS.LAST_DATE);

        if (lastDate !== today) {
            // New day - reset daily stats but keep customers and transactions
            localStorage.setItem(STORAGE_KEYS.LAST_DATE, today);
            localStorage.setItem(STORAGE_KEYS.DAILY_STATS, JSON.stringify({
                date: today,
                revenue: 0,
                paid: 0,
                outstanding: 0,
                transactionCount: 0
            }));
        }
    }

    getTodayString() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    // Customers
    getCustomers(includeArchived = false) {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || '[]');
            if (includeArchived) return data;
            return data.filter(c => !c.archived);
        } catch {
            return [];
        }
    }

    getAllCustomers() {
        return this.getCustomers(true);
    }

    getCustomer(id) {
        const customers = this.getAllCustomers();
        return customers.find(c => c.id === id) || null;
    }

    saveCustomers(customers) {
        localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
        this.updateDailyStats();
    }

    addCustomer(name) {
        const customers = this.getAllCustomers();
        const newCustomer = {
            id: this.generateId(),
            name: name.trim(),
            balance: 0,
            archived: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        customers.push(newCustomer);
        this.saveCustomers(customers);
        return newCustomer;
    }

    updateCustomer(id, updates) {
        const customers = this.getAllCustomers();
        const index = customers.findIndex(c => c.id === id);
        if (index === -1) return null;

        customers[index] = {
            ...customers[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        this.saveCustomers(customers);
        return customers[index];
    }

    archiveCustomer(id) {
        return this.updateCustomer(id, { archived: true });
    }

    unarchiveCustomer(id) {
        return this.updateCustomer(id, { archived: false });
    }

    deleteCustomer(id) {
        const customers = this.getAllCustomers().filter(c => c.id !== id);
        this.saveCustomers(customers);
    }

    // Transactions
    getTransactions() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
        } catch {
            return [];
        }
    }

    saveTransactions(transactions) {
        localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
        this.updateDailyStats();
    }

    addTransaction(transaction) {
        const transactions = this.getTransactions();
        const newTransaction = {
            id: this.generateId(),
            ...transaction,
            timestamp: transaction.timestamp || new Date().toISOString()
        };
        transactions.push(newTransaction);
        this.saveTransactions(transactions);
        return newTransaction;
    }

    removeLastTransaction(customerId) {
        const transactions = this.getTransactions();
        const index = transactions.findLastIndex(t => t.customerId === customerId);
        if (index === -1) return null;

        const removed = transactions.splice(index, 1)[0];
        this.saveTransactions(transactions);
        return removed;
    }

    correctTransaction(transactionId, updates) {
        const transactions = this.getTransactions();
        const index = transactions.findIndex(t => t.id === transactionId);
        if (index === -1) return null;

        transactions[index] = {
            ...transactions[index],
            ...updates,
            corrected: true,
            correctedAt: new Date().toISOString()
        };
        this.saveTransactions(transactions);
        return transactions[index];
    }

    getCustomerTransactions(customerId) {
        return this.getTransactions()
            .filter(t => t.customerId === customerId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    getTodayTransactions() {
        const today = this.getTodayString();
        return this.getTransactions().filter(t => t.timestamp.startsWith(today));
    }

    // Daily Stats
    getDailyStats() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATS) || '{}');
        } catch {
            return {};
        }
    }

    updateDailyStats() {
        const today = this.getTodayString();
        const transactions = this.getTodayTransactions();
        const customers = this.getCustomers();

        let revenue = 0;
        let paid = 0;
        let outstanding = 0;
        let activeCustomers = 0;

        transactions.forEach(t => {
            if (t.type === 'purchase' || t.type === 'correction') {
                revenue += t.amount;
            } else if (t.type === 'payment') {
                paid += t.amount;
            }
        });

        customers.forEach(c => {
            if (c.balance > 0) outstanding += c.balance;
            // Active: not archived AND (balance !== 0 OR no payments made yet)
            if (c.balance !== 0 || !this.hasMadePayment(c.id)) {
                activeCustomers++;
            }
        });

        const stats = {
            date: today,
            revenue,
            paid,
            outstanding,
            transactionCount: transactions.length,
            activeCustomers
        };

        localStorage.setItem(STORAGE_KEYS.DAILY_STATS, JSON.stringify(stats));
        return stats;
    }

    // Settings
    getSettings() {
        try {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}') };
        } catch {
            return DEFAULT_SETTINGS;
        }
    }

    saveSettings(settings) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    }

    // Products
    getProducts() {
        return DEFAULT_PRODUCTS;
    }

    getProduct(id) {
        return DEFAULT_PRODUCTS.find(p => p.id === id);
    }

    // Check if customer has made any payment transactions
    hasMadePayment(customerId) {
        const transactions = this.getCustomerTransactions(customerId);
        return transactions.some(t => t.type === 'payment');
    }

    // Utility
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Backup & Export
    exportAllData() {
        return {
            version: '1.4',
            exportDate: new Date().toISOString(),
            customers: this.getAllCustomers(),
            transactions: this.getTransactions(),
            settings: this.getSettings(),
            dailyStats: this.getDailyStats()
        };
    }

    importAllData(data) {
        if (data.customers) this.saveCustomers(data.customers);
        if (data.transactions) this.saveTransactions(data.transactions);
        if (data.settings) this.saveSettings(data.settings);
        if (data.dailyStats) localStorage.setItem(STORAGE_KEYS.DAILY_STATS, JSON.stringify(data.dailyStats));
    }

    clearAllData() {
        Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
        this.init();
    }
}

// Export singleton instance
export const storage = new Storage();
export { STORAGE_KEYS, DEFAULT_PRODUCTS, DEFAULT_SETTINGS };
