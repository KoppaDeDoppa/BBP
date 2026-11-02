/**
 * State Module - Shared application state
 * BodenBar v1.4
 */

// Application State
let activeCustomerId = null;

// Get active customer ID
export function getActiveCustomerId() {
    return activeCustomerId;
}

// Set active customer ID
export function setActiveCustomerId(id) {
    activeCustomerId = id;
}

// Clear active customer ID
export function clearActiveCustomerId() {
    activeCustomerId = null;
}