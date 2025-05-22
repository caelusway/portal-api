/**
 * Utils for formatting and data transformation
 */

/**
 * Formats a date into a human-readable relative time string
 * @param date The date to format
 * @returns A string like "just now", "5 minutes ago", "2 days ago", etc.
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  // Convert to seconds
  const diffSec = Math.floor(diffMs / 1000);
  
  // Less than a minute
  if (diffSec < 60) {
    return 'just now';
  }
  
  // Minutes
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
  }
  
  // Hours
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  
  // Days
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
  
  // Months
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
  }
  
  // Years
  const diffYears = Math.floor(diffMonths / 12);
  return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
}

/**
 * Stores the date in a standard format along with the relative format
 * This is useful for sorting while still showing relative time
 * @param date The date to format
 * @returns A string with US Eastern time and relative time like "2023-05-15 3:45 PM ET (2 days ago)"
 */
export function formatDateWithRelative(date: Date): string {
  // Convert to US Eastern timezone
  // For date and time without timezone name
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  };
  
  const easternTime = new Intl.DateTimeFormat('en-US', dateTimeOptions).format(date);
  const relativeTime = formatRelativeTime(date);
  
  // Add ET for Eastern Time explicitly
  return `${easternTime} ET (${relativeTime})`;
} 