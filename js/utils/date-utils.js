/**
 * Utility functions for date formatting and calculations
 */

/**
 * Get a human-readable string for how long ago a date was
 * @param {string} dateString - ISO date string
 * @returns {string} Human-readable relative time (e.g., "2 weeks ago", "yesterday")
 */
export function getWeeksAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffWeeks === 1) return '1 week ago';
    if (diffWeeks < 52) return `${diffWeeks} weeks ago`;

    const diffYears = Math.floor(diffWeeks / 52);
    if (diffYears === 1) return '1 year ago';
    return `${diffYears} years ago`;
}
