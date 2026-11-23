// Main solve module

import { parseFrontMatter } from './frontmatter.js';
import { parseMarkdown } from './markdown.js';
import { parseTemplate, renderTemplate } from './template.js';
import { slugify, escapeHtml, dateLong, makeUniqueSlug, countWords, readingMinutes } from './slugify.js';

export function run(input) {
  const { site, templates: rawTemplates, files } = input;
  
  // Step 1: Sort files by path (code-unit order)
  const codeUnit = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const sortedFiles = [...files].sort((a, b) => codeUnit(a.path, b.path));
  
  // Normalize line endings for .md files
  const normalizedFiles = sortedFiles.map(f => ({
    ...f,
    content: f.path.endsWith('.md') ? f.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : f.content
  }));
  
  // Step 2: Parse templates in code-unit order of name
  const templateNames = Object.keys(rawTemplates).sort();
  const templates = {};
  const reports = [];
  const brokenLinks = new Set(); // entries: "<sourcePath> -> <target>"
  
  for (const name of templateNames) {
    const result = parseTemplate(rawTemplates[name], name);
    if (result.error) {
      reports.push(`template "${name}": ${result.error}`);
    } else {
      templates[name] = { source: rawTemplates[name], ast: result.ast };
    }
  }
  
  // Step 3: Process sources
  const sources = [];
  const staticFiles = new Map(); // path -> content
  const sourcePaths = new Set(); // for permalink uniqueness
  
  for (const file of normalizedFiles) {
    if (file.path.endsWith('.md')) {
      sources.push(file);
    } else {
      staticFiles.set(file.path, file.content);
    }
  }
  
  // Parse front matter for each source
  const parsedSources = [];
  const dirSlugs = new Map(); // directory -> Set of used slugs
  
  // Initialize reserved slugs at root
  const rootSlugs = new Set(['posts', 'tags', 'page']);
  dirSlugs.set('', rootSlugs);
  
  for (const source of sources) {
    const { error, frontMatter, bodyStart } = parseFrontMatter(source.content, source.path);
    const body = source.content.split('\n').slice(bodyStart).join('\n');
    
    if (error) {
      reports.push(`refused ${source.path}: ${error}`);
      continue;
    }
    
    // Check if source is under tags/ or page/
    if (source.path.startsWith('tags/') || source.path.startsWith('page/')) {
      reports.push(`refused ${source.path}: generator's own directory`);
      continue;
    }
    
    const isPost = source.path.startsWith('posts/');
    
    // Must have title
    if (!frontMatter.title) {
      reports.push(`refused ${source.path}: no title`);
      continue;
    }
    
    // Post must have date
    if (isPost && !frontMatter.date) {
      reports.push(`refused ${source.path}: a post needs a date`);
      continue;
    }
    
    // Check layout exists and parses
    const layoutName = frontMatter.layout || (isPost ? 'post' : 'page');
    if (!templates[layoutName]) {
      reports.push(`refused ${source.path}: layout "${layoutName}" is no template that parses`);
      continue;
    }
    
    // Check for draft
    if (frontMatter.draft === true) {
      reports.push(`draft ${source.path}`);
      continue;
    }
    
    // Determine directory and slug
    let directory;
    if (isPost) {
      directory = 'posts';
    } else {
      const lastSlash = source.path.lastIndexOf('/');
      directory = lastSlash >= 0 ? source.path.slice(0, lastSlash) : '';
    }
    
    // Get or create slug set for directory
    if (!dirSlugs.has(directory)) {
      dirSlugs.set(directory, new Set());
    }
    const usedSlugs = dirSlugs.get(directory);
    
    // Determine slug
    let slugBase = frontMatter.slug || slugify(frontMatter.title);
    const slug = makeUniqueSlug(slugBase, usedSlugs);
    
    // Build page object
    const page = {
      sourcePath: source.path,
      directory,
      slug,
      title: frontMatter.title,
      summary: frontMatter.summary || '',
      date: frontMatter.date || '',
      tags: frontMatter.tags || [],
      layout: layoutName,
      isPost,
      body,
      bodyHtml: '', // will be filled later
      excerpt: '',
      toc: [],
      readingMinutes: 0,
      url: '',
      dateLong: '',
      newer: null,
      older: null
    };
    
    parsedSources.push(page);
  }
  
  // Step 4: Build permalinks
  const baseUrl = site.base_url.replace(/\/+$/, '');
  
  for (const page of parsedSources) {
    const dirPart = page.directory ? `${page.directory}/` : '';
    page.url = `${baseUrl}/${dirPart}${page.slug}/`;
  }
  
  // Step 5: Render Markdown
  // Build lookup maps for link resolution
  const allPages = {};
  for (const page of parsedSources) {
    const key = page.sourcePath.replace(/\.md$/, '');
    allPages[key] = { url: page.url, slug: page.slug, directory: page.directory };
  }
  const staticFilePaths = new Set(staticFiles.keys());
  
  for (const page of parsedSources) {
    const topBlocks = [];
    const html = parseMarkdown(page.body, page.sourcePath, baseUrl, allPages, staticFilePaths, topBlocks, brokenLinks);
    page.bodyHtml = html;
    
    // Excerpt: the HTML inside the first top-level <p> block
    const firstPara = topBlocks.find(b => b.startsWith('<p>'));
    page.excerpt = firstPara ? firstPara.slice(3, -4) : '';
    
    // Extract TOC (h2 and h3 headings)
    const toc = [];
    let match;
    const headingRegex = /<h([23]) id="([^"]+)">(.*?)<\/h[23]>/g;
    while ((match = headingRegex.exec(html)) !== null) {
      toc.push({
        level: parseInt(match[1], 10),
        id: match[2],
        html: match[3]
      });
    }
    page.toc = toc;
    
    // Reading minutes
    page.readingMinutes = readingMinutes(countWords(page.body));
    
    // Date long
    if (page.date) {
      page.dateLong = dateLong(page.date);
    }
  }
  
  // Step 6: Collections - posts sorted by date desc, then slug asc
  const posts = parsedSources.filter(p => p.isPost);
  posts.sort((a, b) => {
    if (a.date !== b.date) return codeUnit(b.date, a.date); // newest first
    return codeUnit(a.slug, b.slug);
  });
  
  // Set newer/older
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? {
      title: posts[i - 1].title,
      url: posts[i - 1].url,
      date: posts[i - 1].date,
      date_long: posts[i - 1].dateLong
    } : null;
    posts[i].older = i < posts.length - 1 ? {
      title: posts[i + 1].title,
      url: posts[i + 1].url,
      date: posts[i + 1].date,
      date_long: posts[i + 1].dateLong
    } : null;
  }
  
  // Step 7: Tags
  // Walk posts in collection order, collect tags with first spelling
  const tagMap = new Map(); // slug -> { name, slug, posts: [] }
  
  for (const post of posts) {
    for (const tag of post.tags) {
      if (!tagMap.has(tag.slug)) {
        tagMap.set(tag.slug, { name: tag.name, slug: tag.slug, posts: [] });
      }
      tagMap.get(tag.slug).posts.push(post);
    }
  }
  
  // Convert to array and sort by count desc, then slug asc
  const tags = Array.from(tagMap.values());
  tags.sort((a, b) => {
    if (a.posts.length !== b.posts.length) return b.posts.length - a.posts.length;
    return codeUnit(a.slug, b.slug);
  });
  
  // Add url to tags
  for (const tag of tags) {
    tag.url = `${baseUrl}/tags/${tag.slug}/`;
  }
  
  // Add tag objects with url (and the tag's canonical name) to posts
  for (const post of posts) {
    post.tags = post.tags.map(t => {
      const tagInfo = tagMap.get(t.slug);
      return { name: tagInfo ? tagInfo.name : t.name, slug: t.slug, url: tagInfo ? tagInfo.url : '' };
    });
  }
  
  // For pages (non-posts), add tag objects with url
  const pages = parsedSources.filter(p => !p.isPost);
  for (const page of pages) {
    page.tags = page.tags.map(t => {
      const tagInfo = tagMap.get(t.slug);
      return { name: tagInfo ? tagInfo.name : t.name, slug: t.slug, url: tagInfo ? tagInfo.url : '' };
    });
  }
  
  // Step 8: Build output pages
  const output = new Map(); // path -> content
  const builtPagePaths = new Set();
  
  // Helper to create card object
  function makeCard(post) {
    return {
      title: post.title,
      url: post.url,
      date: post.date,
      date_long: post.dateLong,
      summary: post.summary,
      excerpt: post.excerpt,
      reading_minutes: post.readingMinutes,
      tags: post.tags
    };
  }
  
  // Recent posts (cards)
  const recentPosts = posts.slice(0, site.recent).map(makeCard);
  
  // Site object for templates
  const siteObj = {
    title: site.title,
    base_url: baseUrl
  };
  
  // Tags object for templates
  const tagsObj = tags.map(t => ({
    name: t.name,
    slug: t.slug,
    url: t.url,
    count: t.posts.length
  }));
  
  // Helper to render a page through its layout
  function renderPage(page, extraScope = {}) {
    const layout = templates[page.layout];
    if (!layout) return null;
    
    const scope = {
      site: siteObj,
      tags: tagsObj,
      recent: recentPosts,
      page: {
        title: page.title,
        url: page.url,
        date: page.date,
        date_long: page.dateLong,
        summary: page.summary,
        excerpt: page.excerpt,
        reading_minutes: page.readingMinutes,
        tags: page.tags,
        slug: page.slug,
        content: page.bodyHtml,
        toc: page.toc,
        newer: page.newer,
        older: page.older,
        is_post: page.isPost
      },
      ...extraScope
    };
    
    return renderTemplate(layout.ast, scope, templates);
  }
  
  // Render individual pages (posts and pages)
  for (const page of parsedSources) {
    const html = renderPage(page);
    if (html === null) continue; // template missing
    
    const outputPath = `${page.directory ? page.directory + '/' : ''}${page.slug}/index.html`;
    output.set(outputPath, html);
    builtPagePaths.add(outputPath);
  }
  
  // Render index pages (pagination)
  const perPage = site.per_page;
  const totalPosts = posts.length;
  const totalPages = Math.max(1, Math.ceil(totalPosts / perPage));
  
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const start = (pageNum - 1) * perPage;
    const end = Math.min(start + perPage, totalPosts);
    const pagePosts = posts.slice(start, end).map(makeCard);
    
    const pager = {
      number: pageNum,
      total: totalPages,
      url: pageNum === 1 ? `${baseUrl}/` : `${baseUrl}/page/${pageNum}/`,
      newer_url: pageNum > 1 ? (pageNum === 2 ? `${baseUrl}/` : `${baseUrl}/page/${pageNum - 1}/`) : '',
      older_url: pageNum < totalPages ? `${baseUrl}/page/${pageNum + 1}/` : ''
    };
    
    const scope = {
      site: siteObj,
      tags: tagsObj,
      recent: recentPosts,
      posts: pagePosts,
      pager
    };
    
    const indexTemplate = templates.index;
    if (!indexTemplate) continue;
    
    const html = renderTemplate(indexTemplate.ast, scope, templates);
    
    const outputPath = pageNum === 1 ? 'index.html' : `page/${pageNum}/index.html`;
    output.set(outputPath, html);
    builtPagePaths.add(outputPath);
  }
  
  // Render tag pages
  for (const tag of tags) {
    const tagPosts = tag.posts.map(makeCard);
    
    const scope = {
      site: siteObj,
      tags: tagsObj,
      recent: recentPosts,
      tag: {
        name: tag.name,
        slug: tag.slug,
        url: tag.url,
        count: tag.posts.length,
        posts: tagPosts
      }
    };
    
    const tagTemplate = templates.tag;
    if (!tagTemplate) continue;
    
    const html = renderTemplate(tagTemplate.ast, scope, templates);
    const outputPath = `tags/${tag.slug}/index.html`;
    output.set(outputPath, html);
    builtPagePaths.add(outputPath);
  }
  
  // Render tags index page
  const tagsTemplate = templates.tags;
  if (tagsTemplate) {
    const scope = {
      site: siteObj,
      tags: tagsObj,
      recent: recentPosts
    };
    const html = renderTemplate(tagsTemplate.ast, scope, templates);
    const outputPath = 'tags/index.html';
    output.set(outputPath, html);
    builtPagePaths.add(outputPath);
  }
  
  // Step 9: Static files (unless shadowed)
  for (const [path, content] of staticFiles) {
    if (builtPagePaths.has(path)) {
      reports.push(`shadowed ${path}: a built page has its path`);
    } else {
      output.set(path, content);
    }
  }
  
  // Step 10: Build report
  for (const bl of brokenLinks) reports.push(`broken-link ${bl}`);
  
  // Sort reports in code-unit order
  reports.sort();
  const reportLines = [...reports];
  
  reportLines.push(`built ${parsedSources.filter(p => !p.isPost).length} pages, ${posts.length} posts, ${tags.length} tags and ${staticFiles.size} static files`);
  
  output.set('build-report.txt', reportLines.join('\n') + '\n');
  
  // Convert output Map to plain object
  const result = {};
  for (const [path, content] of output) {
    result[path] = content;
  }
  
  return result;
}
