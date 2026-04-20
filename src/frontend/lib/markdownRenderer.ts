export type MarkdownRenderFn = (content: string) => string;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fallbackRender(content: string): string {
  return `<p>${escapeHtml(content).replace(/\n/g, '<br/>')}</p>`;
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
    const rendered = marked.parse(content) as string;
    return DOMPurify.sanitize(rendered);
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
