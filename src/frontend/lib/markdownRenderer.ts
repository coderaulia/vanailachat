export type MarkdownRenderFn = (content: string) => string;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getAlertIcon(type: string): string {
  switch (type) {
    case 'note':
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    case 'tip':
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>`;
    case 'important':
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    case 'warning':
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    case 'caution':
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    default:
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
}

function preprocessMessageContent(content: string): string {
  let result = content;

  // Process completed <think>...</think> blocks
  result = result.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thought) => {
    const trimmed = thought.trim();
    if (!trimmed) return '';
    return `\n\n<details class="thought-process"><summary class="thought-process__summary"><span class="thought-process__icon">💭</span><span class="thought-process__title">Thought Process</span></summary><div class="thought-process__content">\n\n${trimmed}\n\n</div></details>\n\n`;
  });

  // Process unclosed streaming <think>... blocks
  result = result.replace(/<think>([\s\S]*)$/gi, (_, thought) => {
    const trimmed = thought.trim();
    return `\n\n<details class="thought-process is-streaming" open><summary class="thought-process__summary"><span class="thought-process__spinner"></span><span class="thought-process__title">Thinking…</span></summary><div class="thought-process__content">\n\n${trimmed}\n\n</div></details>\n\n`;
  });

  // Separate glued step transitions (e.g. "Laravel:Jelas", "`backend/`:Terungkap")
  result = result.replace(/([:—])([A-ZÀ-ÖØ-öø-ÿ])/g, '$1\n\n$2');

  // Convert raw Claude Code error lines into structured Alert callouts
  result = result.replace(
    /(?:^\s*|\n\s*)(?:\*{0,2}(?:Claude Code|Pi Harness) error:\*{0,2}|(?:Claude Code|Pi Harness) error:)\s*(.*)/gi,
    '\n\n> [!WARNING]\n> **Pi Harness Notice**\n> $1\n\n'
  );

  return result;
}

function fallbackRender(content: string): string {
  const processed = preprocessMessageContent(content);
  return `<p>${escapeHtml(processed).replace(/\n/g, '<br/>')}</p>`;
}

function normalizeLanguage(language: string): string {
  const trimmed = language.trim().toLowerCase();

  switch (trimmed) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'sh':
    case 'shell':
      return 'bash';
    case 'yml':
      return 'yaml';
    case 'html':
      return 'xml';
    case 'md':
      return 'markdown';
    default:
      return trimmed;
  }
}

let rendererPromise: Promise<MarkdownRenderFn> | null = null;

async function buildRenderer(): Promise<MarkdownRenderFn> {
  const [
    markedModule,
    domPurifyModule,
    hljsModule,
    jsModule,
    tsModule,
    jsonModule,
    bashModule,
    pythonModule,
    xmlModule,
    markdownModule,
  ] = await Promise.all([
    import('marked'),
    import('dompurify'),
    import('highlight.js/lib/core'),
    import('highlight.js/lib/languages/javascript'),
    import('highlight.js/lib/languages/typescript'),
    import('highlight.js/lib/languages/json'),
    import('highlight.js/lib/languages/bash'),
    import('highlight.js/lib/languages/python'),
    import('highlight.js/lib/languages/xml'),
    import('highlight.js/lib/languages/markdown'),
  ]);

  const marked = markedModule.marked;
  const DOMPurify = domPurifyModule.default;
  const hljs = hljsModule.default;

  hljs.registerLanguage('javascript', jsModule.default);
  hljs.registerLanguage('typescript', tsModule.default);
  hljs.registerLanguage('json', jsonModule.default);
  hljs.registerLanguage('bash', bashModule.default);
  hljs.registerLanguage('python', pythonModule.default);
  hljs.registerLanguage('xml', xmlModule.default);
  hljs.registerLanguage('markdown', markdownModule.default);

  const renderer = new marked.Renderer();
  renderer.link = ({ href, title, text }) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(href || '')}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
  };

  renderer.blockquote = ({ text }) => {
    const match = text.match(/^\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*([\s\S]*)$/i);
    if (match) {
      const rawType = match[1].toUpperCase();
      const type = rawType.toLowerCase();
      const rest = match[2];
      const icon = getAlertIcon(type);
      let body = rest.startsWith('</p>') ? rest.slice(4) : `<p>${rest}`;
      body = body.replace(/^<p>\s*<\/p>/, '').trim();

      return `
        <div class="markdown-alert markdown-alert-${type}">
          <div class="markdown-alert__header">
            <span class="markdown-alert__icon">${icon}</span>
            <span class="markdown-alert__title">${rawType}</span>
          </div>
          ${body ? `<div class="markdown-alert__content">${body}</div>` : ''}
        </div>
      `;
    }
    return `<blockquote>${text}</blockquote>`;
  };

  renderer.code = ({ text, lang }) => {
    const normalizedLanguage = normalizeLanguage(lang || '');
    const isKnownLanguage = normalizedLanguage.length > 0 && hljs.getLanguage(normalizedLanguage);
    const languageLabel = isKnownLanguage ? normalizedLanguage : 'plaintext';
    const highlighted = isKnownLanguage
      ? hljs.highlight(text, { language: normalizedLanguage, ignoreIllegals: true }).value
      : escapeHtml(text);

    return `
      <div class="code-block">
        <div class="code-block__header">
          <span class="code-block__label">${languageLabel}</span>
          <button type="button" class="copy-code-btn" data-code="${encodeURIComponent(text)}">Copy</button>
        </div>
        <pre><code class="hljs language-${languageLabel}">${highlighted}</code></pre>
      </div>
    `;
  };

  marked.setOptions({
    renderer,
    gfm: true,
    breaks: true,
  });

  return (content: string) => {
    const preprocessed = preprocessMessageContent(content);
    const rendered = marked.parse(preprocessed) as string;
    return DOMPurify.sanitize(rendered, {
      ADD_TAGS: ['details', 'summary', 'svg', 'path', 'polygon', 'polyline', 'rect', 'line', 'circle', 'g'],
      ADD_ATTR: [
        'target',
        'open',
        'class',
        'viewBox',
        'width',
        'height',
        'fill',
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'd',
        'points',
        'x',
        'y',
        'rx',
        'ry',
        'r',
        'cx',
        'cy',
        'aria-hidden',
        'data-code',
      ],
    });
  };
}

export async function getMarkdownRenderer(): Promise<MarkdownRenderFn> {
  if (!rendererPromise) {
    rendererPromise = buildRenderer().catch((error) => {
      rendererPromise = null;
      throw error;
    });
  }

  return rendererPromise;
}

export function renderMarkdownFallback(content: string): string {
  return fallbackRender(content);
}
