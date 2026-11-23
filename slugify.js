// Slugify and utility functions

export function slugify(text) {
  let s = text.normalize('NFKD');
  s = s.replace(/\p{M}/gu, '');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (s.length > 64) {
    s = s.slice(0, 64).replace(/-+$/, '');
  }
  return s || 'untitled';
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Character-by-character escape for use in parseInline
export function escapeHtmlChar(ch) {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '"') return '&quot;';
  if (ch === "'") return '&#39;';
  return ch;
}

export function dateLong(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return day + ' ' + months[month - 1] + ' ' + year;
}

export function makeUniqueSlug(base, used) {
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = base + '-' + n;
    n++;
  }
  used.add(slug);
  return slug;
}

export function countWords(text) {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function readingMinutes(wordCount) {
  return Math.max(1, Math.ceil(wordCount / 200));
}
