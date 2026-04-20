import { useEffect, useState } from 'react';
import {
  getMarkdownRenderer,
  renderMarkdownFallback,
  type MarkdownRenderFn,
} from '../lib/markdownRenderer';

export function useMarkdownRenderer(): MarkdownRenderFn {
  const [renderFn, setRenderFn] = useState<MarkdownRenderFn>(() => renderMarkdownFallback);

  useEffect(() => {
    let isActive = true;

    getMarkdownRenderer()
      .then((renderer) => {
        if (isActive) {
          setRenderFn(() => renderer);
        }
      })
      .catch(() => {
        if (isActive) {
          setRenderFn(() => renderMarkdownFallback);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  return renderFn;
}
