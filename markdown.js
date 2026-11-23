// Markdown parser

import { slugify, escapeHtml, escapeHtmlChar } from './slugify.js';

export function parseMarkdown(body, sourcePath, baseUrl, allPages, staticFiles, topBlocks, broken) {
  // allPages: map of source path -> { url, slug, directory }
  // staticFiles: set of static file paths
  
  const lines = body.split('\n');
  let i = 0;
  const blocks = [];
  const headingIds = new Set();
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Skip blank lines
    if (/^[ \t]*$/.test(line)) {
      i++;
      continue;
    }
    
    // Fence
    const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)[ \t]*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      i++;
      const codeLines = [];
      while (i < lines.length) {
        if (/^```[ \t]*$/.test(lines[i])) {
          i++;
          break;
        }
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      const codeContent = codeLines.join('\n') + '\n';
      if (lang) {
        blocks.push(`<pre><code class="language-${lang}">${codeContent}</code></pre>`);
        if (topBlocks) topBlocks.push(`<pre><code class="language-${lang}">${codeContent}</code></pre>`);
      } else {
        blocks.push(`<pre><code>${codeContent}</code></pre>`);
        if (topBlocks) topBlocks.push(`<pre><code>${codeContent}</code></pre>`);
      }
      continue;
    }
    
    // Heading
    const headingMatch = line.match(/^(#{1,6})[ \t]+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let text = headingMatch[2].replace(/[ \t]+$/, ''); // trim trailing spaces/tabs
      // Closing #s are kept as text (spec says so)
      
      if (text === '') {
        // Not a heading - treat as paragraph
        // We'll handle this below
      } else {
        let id = slugify(text);
        let origId = id;
        let n = 2;
        while (headingIds.has(id)) {
          id = `${origId}-${n}`;
          n++;
        }
        headingIds.add(id);
        const inlineHtml = parseInline(text, sourcePath, baseUrl, allPages, staticFiles, broken);
        blocks.push(`<h${level} id="${id}">${inlineHtml}</h${level}>`);
        if (topBlocks) topBlocks.push(`<h${level} id="${id}">${inlineHtml}</h${level}>`);
        i++;
        continue;
      }
    }
    
    // Thematic break
    if (/^(---|\*\*\*)[ \t]*$/.test(line)) {
      blocks.push('<hr>');
      if (topBlocks) topBlocks.push('<hr>');
      i++;
      continue;
    }
    
    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        let l = lines[i].slice(1);
        if (l.startsWith(' ')) l = l.slice(1);
        l = l.trim();
        if (l !== '') quoteLines.push(l);
        i++;
      }
      if (quoteLines.length > 0) {
        const content = parseInline(quoteLines.join('\n'), sourcePath, baseUrl, allPages, staticFiles, broken);
        blocks.push(`<blockquote>\n<p>${content}</p>\n</blockquote>`);
        if (topBlocks) topBlocks.push(`<blockquote>\n<p>${content}</p>\n</blockquote>`);
      } else {
        blocks.push('<blockquote>\n</blockquote>');
        if (topBlocks) topBlocks.push('<blockquote>\n</blockquote>');
      }
      continue;
    }
    
    // List
    const bulletMatch = line.match(/^([-*]) (.*)$/);
    const orderedMatch = line.match(/^(\d+)\. (.*)$/);
    if (bulletMatch || orderedMatch) {
      const isOrdered = !!orderedMatch;
      const startNum = isOrdered ? parseInt(orderedMatch[1], 10) : null;
      const items = [];
      let firstItem = true;
      
      while (i < lines.length) {
        const l = lines[i];
        const bm = l.match(/^([-*]) (.*)$/);
        const om = l.match(/^(\d+)\. (.*)$/);
        
        if ((isOrdered && om) || (!isOrdered && bm)) {
          let itemText = (bm || om)[2];
          i++;
          
          // Continuation lines (2+ spaces then non-space)
          while (i < lines.length && /^ {2,}\S/.test(lines[i])) {
            itemText += '\n' + lines[i].slice(2);
            i++;
          }
          
          items.push(itemText.trim());
          firstItem = false;
        } else {
          break;
        }
      }
      
      let listHtml = '';
      if (isOrdered) {
        if (startNum !== 1) {
          listHtml = `<ol start="${startNum}">\n`;
        } else {
          listHtml = '<ol>\n';
        }
      } else {
        listHtml = '<ul>\n';
      }
      for (const item of items) {
        listHtml += `<li>${parseInline(item, sourcePath, baseUrl, allPages, staticFiles, broken)}</li>\n`;
      }
      listHtml += isOrdered ? '</ol>' : '</ul>';
      blocks.push(listHtml);
      if (topBlocks) topBlocks.push(listHtml);
      continue;
    }
    
    // Paragraph
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (/^[ \t]*$/.test(l)) break;
      if (/^```/.test(l)) break;
      if (/^#{1,6}[ \t]/.test(l)) break;
      if (/^(---|\*\*\*)[ \t]*$/.test(l)) break;
      paraLines.push(l.trim());
      i++;
    }
    if (paraLines.length > 0) {
      const content = paraLines.join('\n');
      const paraHtml = `<p>${parseInline(content, sourcePath, baseUrl, allPages, staticFiles, broken)}</p>`;
      blocks.push(paraHtml);
      if (topBlocks) topBlocks.push(paraHtml);
    }
  }
  
  return blocks.join('\n') + '\n';
}

function parseInline(text, sourcePath, baseUrl, allPages, staticFiles, broken) {
  let result = '';
  let i = 0;

  // escaped[i]: text[i] is the second character of a \X escape pair
  const esc = new Array(text.length).fill(false);
  for (let k = 0; k + 1 < text.length; k++) {
    if (text[k] === '\\' && '\\`*_[]()#+-.!>'.includes(text[k + 1])) {
      esc[k + 1] = true;
      k++;
    }
  }
  // a star is "free" if it is unescaped and not adjacent to another
  // unconsumed (not yet written/delimiter-used) star
  const used = new Array(text.length).fill(false);
  const isFreeStar = (k) =>
    text[k] === '*' && !esc[k] && !used[k] &&
    !(k > 0 && text[k - 1] === '*' && !esc[k - 1] && !used[k - 1]) &&
    !(k + 1 < text.length && text[k + 1] === '*' && !esc[k + 1] && !used[k + 1]);

  while (i < text.length) {
    const ch = text[i];

    // Escape: \X writes X literally (HTML-escaped)
    if (ch === '\\' && i + 1 < text.length && esc[i + 1]) {
      result += escapeHtml(text[i + 1]);
      i += 2;
      continue;
    }

    // Code span
    if (ch === '`' && !esc[i]) {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        const codeContent = text.slice(i + 1, end);
        result += `<code>${escapeHtml(codeContent)}</code>`;
        i = end + 1;
        continue;
      }
    }

    // Strong ** (both stars unescaped), at least one character between.
    // The closer is the FIRST unescaped ** after the opener; if that first one is
    // adjacent (empty content), the pair itself is literal text and scanning
    // resumes right after it.
    if (ch === '*' && !esc[i] && text.startsWith('**', i)) {
      const closer = findStrongCloser(text, i + 2, esc);
      if (closer > 0) {
        used[i] = used[i + 1] = used[closer] = used[closer + 1] = true;
        const inner = text.slice(i + 2, closer);
        result += `<strong>${parseInline(inner, sourcePath, baseUrl, allPages, staticFiles, broken)}</strong>`;
        i = closer + 2;
        continue;
      }
      // no valid closer: write this ** literally and move past it
      used[i] = used[i + 1] = true;
      result += '**';
      i += 2;
      continue;
    }

    // Emphasis * : free star (unescaped, not beside an unconsumed star),
    // closed by the next free star with >=1 char between
    if (ch === '*' && !esc[i] && isFreeStar(i)) {
      // Closer scan: skip escaped stars and whole ** pairs (marking them
      // consumed); the closer is the next lone unescaped star.
      const used2 = used.slice();
      let end = -1;
      for (let k = i + 2; k < text.length; k++) {
        if (esc[k]) continue;
        if (text[k] === '*') {
          if (k + 1 < text.length && text[k + 1] === '*' && !esc[k + 1]) {
            used2[k] = used2[k + 1] = true;
            k++;
            continue;
          }
          if (isFreeStar(k) || used2[k - 1] === true) { end = k; break; }
          // lone star blocked by adjacency rules: keep scanning
        }
      }
      if (end > i + 1) {
        for (let k = 0; k < used2.length; k++) if (used2[k]) used[k] = true;
        used[i] = used[end] = true;
        const inner = text.slice(i + 1, end);
        result += `<em>${parseInline(inner, sourcePath, baseUrl, allPages, staticFiles, broken)}</em>`;
        i = end + 1;
        continue;
      }
      // no closer: the star is itself
      used[i] = true;
    }
    
    // Link [text](target)
    if (ch === '[') {
      const linkResult = parseLink(text, i, sourcePath, baseUrl, allPages, staticFiles, broken);
      if (linkResult) {
        result += linkResult.html;
        i = linkResult.nextIndex;
        continue;
      }
    }
    
    // Regular character
    result += escapeHtmlChar(ch);
    i++;
  }
  
  return result;
}

function findStrongCloser(text, start, esc) {
  // the FIRST unescaped ** at or after start; -1 when none or when adjacent to start
  for (let k = start; k + 1 < text.length; k++) {
    if (text[k] === '*' && text[k + 1] === '*' && !esc[k] && !esc[k + 1]) {
      return k > start ? k : -1;
    }
    if (esc[k]) continue;
  }
  return -1;
}

function parseLink(text, start, sourcePath, baseUrl, allPages, staticFiles, broken) {
  // Find closing ] not escaped
  let i = start + 1;
  let linkText = '';
  
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length && '\\`*_[]()#+-.!>'.includes(text[i + 1])) {
      // keep the escape pair intact so re-parsing renders it literally
      linkText += text[i] + text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === ']') {
      // the first unescaped ] closes the text (no bracket nesting)
      break;
    }
    linkText += text[i];
    i++;
  }
  
  if (i >= text.length || text[i] !== ']') return null;
  i++; // past ]
  
  if (i >= text.length || text[i] !== '(') return null;
  i++; // past (
  
  // Find closing )
  let target = '';
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      target += text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === ')') break;
    target += text[i];
    i++;
  }
  
  if (i >= text.length || text[i] !== ')') return null;
  if (target === '' || /\s/.test(target)) return null;
  
  i++; // past )
  
  // Resolve target
  let href = resolveLink(target, sourcePath, baseUrl, allPages, staticFiles, broken);
  
  const linkHtml = `<a href="${escapeHtml(href)}">${parseInline(linkText, sourcePath, baseUrl, allPages, staticFiles, broken)}</a>`;
  return { html: linkHtml, nextIndex: i };
}

function resolveLink(target, sourcePath, baseUrl, allPages, staticFiles, broken) {
  // Absolute URL with scheme
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    return target;
  }
  // Absolute path or fragment
  if (target.startsWith('/') || target.startsWith('#')) {
    return target;
  }
  
  // Relative path from source directory
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/') + 1);
  let resolved = resolveRelativePath(sourceDir, target);
  
  // Check if it's a page
  const hashIndex = resolved.indexOf('#');
  let pathPart = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved;
  let fragment = hashIndex >= 0 ? resolved.slice(hashIndex) : '';
  
  // Remove trailing slash from pathPart for lookup
  if (pathPart.endsWith('/')) pathPart = pathPart.slice(0, -1);
  if (pathPart === '') pathPart = '.';
  
  // Remove .md extension if present
  if (pathPart.endsWith('.md')) {
    pathPart = pathPart.slice(0, -3);
  }
  
  // Check pages (exact source-path match, .md stripped)
  const pageEntry = allPages[pathPart];
  if (pageEntry) {
    return pageEntry.url + fragment;
  }

  // Check static files (exact path match)
  if (staticFiles.has(pathPart)) {
    return baseUrl + '/' + pathPart + fragment;
  }
  
  // Broken link - keep as written
  if (broken) broken.add(sourcePath + " -> " + target);
  return target;
}

function resolveRelativePath(base, target) {
  const baseParts = base.split('/').filter(p => p !== '');
  const targetParts = target.split('/');
  
  for (const part of targetParts) {
    if (part === '..') {
      if (baseParts.length > 0) baseParts.pop();
    } else if (part !== '.' && part !== '') {
      baseParts.push(part);
    }
  }
  
  return baseParts.join('/');
}
