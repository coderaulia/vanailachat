// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { getMarkdownRenderer, renderMarkdownFallback } from '../lib/markdownRenderer';
import type { MarkdownRenderFn } from '../lib/markdownRenderer';

let render: MarkdownRenderFn;

function dom(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

beforeAll(async () => {
  render = await getMarkdownRenderer();
});

describe('markdown renderer sanitization', () => {
  it('strips script tags and inline event handlers from model output', () => {
    const html = dom(render('hi <script>alert(1)</script><img src=x onerror="alert(2)"><b onclick="x()">b</b>'));
    expect(html.querySelector('script')).toBeNull();
    expect(html.innerHTML).not.toMatch(/onerror|onclick/i);
  });

  it('drops javascript: link targets', () => {
    const html = dom(render('[click](javascript:alert(1))'));
    const href = html.querySelector('a')?.getAttribute('href') ?? '';
    expect(href.toLowerCase()).not.toContain('javascript:');
  });

  it('opens links in a new tab without an opener', () => {
    const link = dom(render('[docs](https://example.com)')).querySelector('a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('removes iframes, forms, inputs, style tags and inline styles', () => {
    const html = dom(render('<iframe src="https://evil"></iframe><form action="https://evil/login"><input name="pw"><button formaction="https://evil">Go</button></form><style>*{}</style><div style="position:fixed">x</div>'));
    expect(html.querySelector('iframe, form, input, style')).toBeNull();
    expect(html.innerHTML).not.toMatch(/style=|action=/i);
  });

  it('escapes HTML inside code blocks instead of rendering it', () => {
    const html = dom(render('```\n<img src=x onerror=alert(1)>\n```'));
    expect(html.querySelector('img')).toBeNull();
    expect(html.querySelector('code')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('markdown renderer features', () => {
  it('highlights known languages and labels the block', () => {
    const html = dom(render('```ts\nconst x: number = 1;\n```'));
    expect(html.querySelector('.code-block__label')?.textContent).toBe('typescript');
    expect(html.querySelector('code.hljs .hljs-keyword')).not.toBeNull();
    expect(decodeURIComponent(html.querySelector('.copy-code-btn')?.getAttribute('data-code') ?? '')).toBe('const x: number = 1;');
  });

  it('turns <think> blocks into a collapsible section', () => {
    const html = dom(render('<think>planning</think>Answer'));
    expect(html.querySelector('details.thought-process')?.textContent).toContain('planning');
    expect(html.textContent).toContain('Answer');
  });

  it('shows an unfinished <think> block as streaming', () => {
    expect(dom(render('<think>still going')).querySelector('details.is-streaming')).not.toBeNull();
  });

  it('renders GitHub-style alerts', () => {
    const html = dom(render('> [!WARNING]\n> Careful'));
    expect(html.querySelector('.markdown-alert-warning')?.textContent).toContain('Careful');
  });

  it('renders markdown inside blockquotes and link text', () => {
    const html = dom(render('> **bold** quote\n\n[**docs**](https://example.com)'));
    expect(html.querySelector('blockquote strong')?.textContent).toBe('bold');
    expect(html.querySelector('a strong')?.textContent).toBe('docs');
  });

  it('renders tables', () => {
    expect(dom(render('| a | b |\n|---|---|\n| 1 | 2 |')).querySelectorAll('td')).toHaveLength(2);
  });
});

describe('fallback renderer', () => {
  it('escapes everything', () => {
    const html = renderMarkdownFallback('<script>x</script>\nline');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br/>');
  });
});
