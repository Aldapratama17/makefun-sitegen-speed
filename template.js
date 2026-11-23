// Template parser and renderer

export function parseTemplate(source, name) {
  const tokens = tokenize(source);
  if (tokens.error) return { ast: null, error: tokens.error };
  const ast = parseTokens(tokens, name);
  return ast;
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  
  while (i < source.length) {
    if (source.startsWith('{{{', i)) {
      let j = i + 3;
      while (j < source.length && !source.startsWith('}}}', j)) j++;
      if (j >= source.length) return { tokens: null, error: 'unclosed {{{' };
      tokens.push({ type: 'raw', content: source.slice(i + 3, j).trim() });
      i = j + 3;
    } else if (source.startsWith('{{', i)) {
      let j = i + 2;
      while (j < source.length && !source.startsWith('}}', j)) j++;
      if (j >= source.length) return { tokens: null, error: 'unclosed {{' };
      tokens.push({ type: 'escaped', content: source.slice(i + 2, j).trim() });
      i = j + 2;
    } else if (source.startsWith('{%', i)) {
      let j = i + 2;
      while (j < source.length && !source.startsWith('%}', j)) j++;
      if (j >= source.length) return { tokens: null, error: 'unclosed {%' };
      const tagContent = source.slice(i + 2, j).trim();
      
      let lineStart = i;
      while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
      const beforeTag = source.slice(lineStart, i);
      const onlySpacesBefore = /^[ \t]*$/.test(beforeTag);
      
      let lineEnd = j + 2;
      while (lineEnd < source.length && source[lineEnd] !== '\n') lineEnd++;
      const afterTag = source.slice(j + 2, lineEnd);
      const onlySpacesAfter = /^[ \t]*$/.test(afterTag);
      
      if (onlySpacesBefore && onlySpacesAfter) {
        if (lineEnd < source.length && source[lineEnd] === '\n') {
          lineEnd++;
        }
        tokens.push({ type: 'tag', content: tagContent, aloneOnLine: true });
        // Remove leading whitespace from previous text token if it exists
        if (tokens.length >= 2) {
          const prevToken = tokens[tokens.length - 2];
          if (prevToken.type === 'text' && /^[ \t]*$/.test(prevToken.content)) {
            tokens.splice(tokens.length - 2, 1);
          }
        }
        i = lineEnd;
      } else if (onlySpacesBefore) {
        // Mixed line: keep the leading whitespace (spec: only a tag alone on its
        // line takes the line with it; text before a tag on a mixed line stays)
        tokens.push({ type: 'tag', content: tagContent, aloneOnLine: false });
        i = j + 2;
      } else {
        tokens.push({ type: 'tag', content: tagContent, aloneOnLine: false });
        i = j + 2;
      }
    } else {
      let j = i;
      while (j < source.length) {
        if (source.startsWith('{{{', j) || source.startsWith('{{', j) || source.startsWith('{%', j)) {
          break;
        }
        j++;
      }
      tokens.push({ type: 'text', content: source.slice(i, j) });
      i = j;
    }
  }
  
  // Post-process: remove trailing spaces/tabs from text tokens before aloneOnLine tags
  // Only remove newlines if the text is ONLY whitespace
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].type === 'tag' && tokens[k].aloneOnLine && k > 0) {
      const prevToken = tokens[k - 1];
      if (prevToken.type === 'text') {
        // Check if text is only whitespace
        if (/^[ \t\n]*$/.test(prevToken.content)) {
          // Entirely whitespace - keep exactly ONE newline if it had any
          const newlineCount = (prevToken.content.match(/\n/g) || []).length;
          if (newlineCount > 0) {
            // Replace with a single newline
            prevToken.content = '\n';
          } else {
            // Only spaces/tabs - remove it
            tokens.splice(k - 1, 1);
            k--;
          }
        } else {
          // Only remove trailing spaces/tabs, keep newlines
          prevToken.content = prevToken.content.replace(/[ \t]+$/, '');
        }
      }
    }
  }

  return { tokens, error: null };
}

function parseTokens({ tokens }, name) {
  let pos = 0;
  
  function parseBlock(stopTags = new Set()) {
    const nodes = [];
    
    while (pos < tokens.length) {
      const token = tokens[pos];
      
      if (token.type === 'text') {
        nodes.push({ type: 'text', content: token.content });
        pos++;
      } else if (token.type === 'escaped') {
        nodes.push({ type: 'escaped', expr: token.content });
        pos++;
      } else if (token.type === 'raw') {
        nodes.push({ type: 'raw', expr: token.content });
        pos++;
      } else if (token.type === 'tag') {
        if (stopTags.has(token.content)) {
          return { nodes, stop: token.content };
        }
        
        pos++;
        const tagResult = parseTag(token.content, stopTags);
        if (tagResult.error) return { nodes: null, error: tagResult.error };
        if (tagResult.stop) {
          return { nodes, stop: tagResult.stopTag };
        }
        nodes.push(tagResult.node);
      }
    }
    
    return { nodes, error: null };
  }
  
  function parseTag(content, stopTags) {
    if (content.startsWith('for ')) {
      const match = content.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+)$/);
      if (!match) return { error: 'invalid for syntax' };
      const varName = match[1];
      const path = match[2].trim();
      const bodyResult = parseBlock(new Set(['endfor']));
      if (bodyResult.error) return { error: bodyResult.error };
      if (!bodyResult.stop || bodyResult.stop !== 'endfor') {
        return { error: 'for not closed' };
      }
      pos++;
      return { node: { type: 'for', var: varName, path, body: bodyResult.nodes }, stop: false };
    } else if (content.startsWith('if ')) {
      let negate = false;
      let path = content.slice(3).trim();
      if (path.startsWith('not ')) {
        negate = true;
        path = path.slice(4).trim();
      }
      const thenResult = parseBlock(new Set(['else', 'endif']));
      if (thenResult.error) return { error: thenResult.error };
      let elseBody = null;
      if (thenResult.stop === 'else') {
        pos++;
        const elseResult = parseBlock(new Set(['endif']));
        if (elseResult.error) return { error: elseResult.error };
        if (!elseResult.stop || elseResult.stop !== 'endif') {
          return { error: 'if not closed' };
        }
        elseBody = elseResult.nodes;
        pos++;
      } else if (thenResult.stop === 'endif') {
        pos++;
      } else {
        return { error: 'if not closed' };
      }
      
      return { node: { type: 'if', path, negate, thenBody: thenResult.nodes, elseBody }, stop: false };
    } else if (content.startsWith('include ')) {
      const match = content.match(/^include\s+"([^"]+)"$/);
      if (!match) return { error: 'invalid include syntax' };
      return { node: { type: 'include', name: match[1] }, stop: false };
    } else if (content === 'endfor') {
      return { node: null, stop: true, stopTag: 'endfor' };
    } else if (content === 'endif') {
      return { node: null, stop: true, stopTag: 'endif' };
    } else if (content === 'else') {
      return { node: null, stop: true, stopTag: 'else' };
    } else {
      return { error: 'unknown tag: ' + content };
    }
  }
  
  const result = parseBlock();
  if (result.error) return { ast: null, error: result.error };
  return { ast: result.nodes, error: null };
}

export function renderTemplate(ast, scope, templates, includeDepth = 0) {
  if (includeDepth > 8) return '';
  
  let output = '';
  
  for (const node of ast) {
    if (node.type === 'text') {
      output += node.content;
    } else if (node.type === 'escaped') {
      const value = resolvePath(node.expr, scope);
      output += escapeHtml(valueToString(value));
    } else if (node.type === 'raw') {
      const value = resolvePath(node.expr, scope);
      output += valueToString(value);
    } else if (node.type === 'for') {
      const arr = resolvePath(node.path, scope);
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          const loopScope = Object.create(scope);
          loopScope[node.var] = item;
          loopScope.loop = { index: i + 1, first: i === 0, last: i === arr.length - 1, length: arr.length };
          output += renderTemplate(node.body, loopScope, templates, includeDepth);
        }
      }
    } else if (node.type === 'if') {
      const value = resolvePath(node.path, scope);
      const truthy = isTruthy(value);
      const condition = node.negate ? !truthy : truthy;
      const body = condition ? node.thenBody : (node.elseBody || []);
      output += renderTemplate(body, scope, templates, includeDepth);
    } else if (node.type === 'include') {
      const template = templates[node.name];
      if (template && template.ast) {
        output += renderTemplate(template.ast, scope, templates, includeDepth + 1);
      }
    }
  }
  
  return output;
}

const pathPartsCache = new Map();
function resolvePath(path, scope) {
  let parts = pathPartsCache.get(path);
  if (!parts) {
    parts = path.split('.').map(p => p.trim());
    pathPartsCache.set(path, parts);
  }
  if (parts.length === 0) return undefined;
  
  let value = scope;
  
  if (parts[0] === 'loop') {
    if (scope.loop) {
      value = scope.loop;
      for (let i = 1; i < parts.length; i++) {
        if (value && typeof value === 'object' && parts[i] in value) {
          value = value[parts[i]];
        } else {
          return undefined;
        }
      }
      return value;
    }
  }
  
  if (parts[0] in scope) {
    value = scope[parts[0]];
  } else {
    return undefined;
  }
  
  for (let i = 1; i < parts.length; i++) {
    if (value && typeof value === 'object' && parts[i] in value) {
      value = value[parts[i]];
    } else {
      return undefined;
    }
  }
  
  return value;
}

function isTruthy(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function valueToString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.map(valueToString).join(', ');
  return '';
}

const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escRe = /[&<>"']/g;
function escapeHtml(text) {
  const str = String(text);
  if (!escRe.test(str)) return str;
  escRe.lastIndex = 0;
  return str.replace(escRe, (c) => escMap[c]);
}

