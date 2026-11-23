// Front matter parser

import { slugify } from './slugify.js';

export function parseFrontMatter(content, path) {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return { error: 'no front matter', frontMatter: null, bodyStart: 0 };
  }
  
  let i = 1;
  const fm = {};
  const seenKeys = new Set();
  let lineNum = 0; // line number within front matter (1-indexed from opening ---)
  
  while (i < lines.length) {
    const line = lines[i];
    if (line === '---') {
      // Found closing ---
      const body = lines.slice(i + 1).join('\n');
      return { error: null, frontMatter: fm, bodyStart: i + 1 };
    }
    
    lineNum++;
    
    // Skip blank lines and comments
    if (/^[ \t]*$/.test(line) || /^[ \t]*#/.test(line)) {
      i++;
      continue;
    }
    
    // Parse key: value
    const match = line.match(/^([a-z_]+): ?(.*)$/);
    if (!match) {
      return { error: `line ${lineNum + 1} is not "key: value"`, frontMatter: null, bodyStart: 0 };
    }
    
    const key = match[1];
    let value = match[2].replace(/[ \t]+$/, ''); // trim trailing spaces/tabs
    
    if (seenKeys.has(key)) {
      return { error: `key "${key}" is given twice`, frontMatter: null, bodyStart: 0 };
    }
    seenKeys.add(key);
    
    // Empty value
    if (value === '') {
      return { error: `key "${key}" has no value`, frontMatter: null, bodyStart: 0 };
    }
    
    // Validate key
    const validKeys = ['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug'];
    if (!validKeys.includes(key)) {
      return { error: `unknown key "${key}"`, frontMatter: null, bodyStart: 0 };
    }
    
    // Parse value based on key
    if (key === 'title' || key === 'summary') {
      // Quoted or bare string
      if (value.startsWith('"')) {
        // Quoted string - parse escapes
        if (!value.endsWith('"')) {
          return { error: `key "${key}": a quoted string is not closed`, frontMatter: null, bodyStart: 0 };
        }
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      } else {
        // Bare string - must not start with " or [
        if (value.startsWith('"') || value.startsWith('[')) {
          return { error: `key "${key}": a bare string opens on [`, frontMatter: null, bodyStart: 0 };
        }
      }
      if (value === '') {
        return { error: `key "${key}" has no value`, frontMatter: null, bodyStart: 0 };
      }
      fm[key] = value;
    } else if (key === 'date') {
      // YYYY-MM-DD, real day 1970-01-01 to 2099-12-31
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { error: `key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)`, frontMatter: null, bodyStart: 0 };
      }
      const [y, m, d] = value.split('-').map(Number);
      if (y < 1970 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) {
        return { error: `key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)`, frontMatter: null, bodyStart: 0 };
      }
      // Validate actual day (e.g., Feb 30)
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        return { error: `key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)`, frontMatter: null, bodyStart: 0 };
      }
      fm[key] = value;
    } else if (key === 'tags') {
      // [a, b, c] format
      if (!value.startsWith('[') || !value.endsWith(']')) {
        return { error: `key "tags": not a list [a, b]`, frontMatter: null, bodyStart: 0 };
      }
      const inner = value.slice(1, -1).trim();
      if (inner === '') {
        fm[key] = [];
      } else {
        const tags = inner.split(',').map(t => t.trim());
        for (const tag of tags) {
          if (tag === '' || tag.includes('"') || tag.includes('[') || tag.includes(']')) {
            return { error: `key "tags": an empty tag, or one holding " [ or ]`, frontMatter: null, bodyStart: 0 };
          }
        }
        // Keep first spelling of each slug
        const seen = new Set();
        const uniqueTags = [];
        for (const tag of tags) {
          const slug = slugify(tag);
          if (!seen.has(slug)) {
            seen.add(slug);
            uniqueTags.push({ name: tag, slug });
          }
        }
        fm[key] = uniqueTags;
      }
    } else if (key === 'draft') {
      if (value !== 'true' && value !== 'false') {
        return { error: `key "draft": true or false`, frontMatter: null, bodyStart: 0 };
      }
      fm[key] = value === 'true';
    } else if (key === 'layout') {
      if (!/^[a-z0-9-]+$/.test(value)) {
        return { error: `key "layout": invalid name`, frontMatter: null, bodyStart: 0 };
      }
      fm[key] = value;
    } else if (key === 'slug') {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
        return { error: `key "slug": not a slug`, frontMatter: null, bodyStart: 0 };
      }
      fm[key] = value;
    }
    
    i++;
  }
  
  return { error: 'the front matter is not closed', frontMatter: null, bodyStart: 0 };
}
