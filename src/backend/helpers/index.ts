export function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function extractImageBase64(url: string): string {
  const dataUrlMarker = ';base64,';
  const markerIndex = url.indexOf(dataUrlMarker);
  if (markerIndex === -1) {
    return url;
  }

  return url.slice(markerIndex + dataUrlMarker.length);
}

export function parseOllamaError(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error) {
      if (typeof parsed.error === 'string' && (parsed.error.startsWith('{') || parsed.error.startsWith('['))) {
        try {
          const nested = JSON.parse(parsed.error);
          return nested.error || parsed.error;
        } catch {
          return parsed.error;
        }
      }
      return parsed.error;
    }
    return responseText;
  } catch {
    return responseText;
  }
}

export function normalizeMessageContent(content: unknown): { content: string; images?: string[] } {
  if (typeof content === 'string') {
    return { content };
  }

  if (!Array.isArray(content)) {
    return { content: String(content ?? '') };
  }

  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }

    const typedPart = part as {
      type?: unknown;
      text?: unknown;
      image_url?: { url?: unknown };
    };

    if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
      textParts.push(typedPart.text);
      continue;
    }

    if (
      typedPart.type === 'image_url' &&
      typedPart.image_url &&
      typeof typedPart.image_url.url === 'string'
    ) {
      images.push(extractImageBase64(typedPart.image_url.url));
    }
  }

  const normalized = {
    content: textParts.join('\n').trim(),
  };

  if (images.length > 0) {
    return { ...normalized, images };
  }

  return normalized;
}
