// Organisation management utilities
// Note: "Organisation" is used internally, but UI displays "Church" to users

const ORGANISATION_KEY = 'setalight-current-organisation';
const DEFAULT_ORGANISATION = 'TEST';

/**
 * Get the currently active organisation name
 * @returns {string} Current organisation name
 */
export function getCurrentOrganisation() {
    return localStorage.getItem(ORGANISATION_KEY) || DEFAULT_ORGANISATION;
}

/**
 * Set the current organisation
 * @param {string} organisationName - Name of organisation to set as current
 */
export function setCurrentOrganisation(organisationName) {
    localStorage.setItem(ORGANISATION_KEY, organisationName);
}

/**
 * List all available organisations
 * @returns {Promise<string[]>} Array of organisation names
 */
export async function listOrganisations() {
    const databases = await indexedDB.databases();
    const organisations = databases
        .filter(db => db.name && db.name.startsWith('SetalightDB-'))
        .map(db => db.name.replace('SetalightDB-', ''))
        .filter(name => name !== ''); // Filter out legacy DB without organisation name

    return organisations.sort();
}

/**
 * Check if an organisation exists
 * @param {string} organisationName - Name of organisation to check
 * @returns {Promise<boolean>} True if organisation exists
 */
export async function organisationExists(organisationName) {
    const organisations = await listOrganisations();
    return organisations.includes(organisationName);
}
