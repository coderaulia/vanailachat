export interface TextReadToolCall {
  name: 'list_directory' | 'read_file' | 'search_files';
  args: Record<string, unknown>;
}

function tokenizeCommand(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  for (const match of value.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function addSearchCalls(source: string, add: (call: TextReadToolCall) => void): void {
  const commandLines = source.replace(/&&|;/g, '\n').split(/\r?\n/);

  for (const line of commandLines) {
    const tokens = tokenizeCommand(line);
    const commandIndex = tokens.findIndex((token) =>
      /^(?:grep|rg|select-string|findstr)$/i.test(token),
    );
    if (commandIndex === -1) continue;

    const command = tokens[commandIndex].toLowerCase();
    let query: string | null = null;
    let searchPath = '.';
    let filePattern: string | null = null;

    if (command === 'select-string') {
      const patternIndex = tokens.findIndex((token) => /^-pattern$/i.test(token));
      const pathIndex = tokens.findIndex((token) => /^-path$/i.test(token));
      query = patternIndex >= 0 ? tokens[patternIndex + 1] ?? null : null;
      const target = pathIndex >= 0 ? tokens[pathIndex + 1] : undefined;
      if (target?.includes('*')) filePattern = target.replaceAll('\\', '/');
      else if (target) searchPath = target;
    } else {
      const operands: string[] = [];
      for (let index = commandIndex + 1; index < tokens.length; index++) {
        const token = tokens[index];
        if ((token === '-g' || token === '--glob') && tokens[index + 1]) {
          filePattern = tokens[++index].replaceAll('\\', '/');
        } else if (!token.startsWith('-') && !token.startsWith('/')) {
          operands.push(token);
        }
      }
      query = operands[0] ?? null;
      const target = operands[1];
      if (target?.includes('*')) filePattern = target.replaceAll('\\', '/');
      else if (target) searchPath = target;
    }

    if (query) {
      add({
        name: 'search_files',
        args: {
          query,
          path: searchPath,
          ...(filePattern ? { file_pattern: filePattern } : {}),
        },
      });
    }
  }
}

const MAX_FALLBACK_CALLS = 8;

/**
 * Some models announce that they are about to inspect a project but never
 * emit the promised tool call. Recognize only short, action-oriented
 * preambles so normal coding answers are not intercepted.
 */
export function isProjectInspectionPreamble(content: string): boolean {
  const normalized = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?.+?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || normalized.length > 500) return false;

  return /^(?:let me|i(?:'ll| will)|first,?\s+i(?:'ll| will))\b[\s\S]*\b(?:inspect|explore|read|check|review|analy[sz]e|tools?)\b/i.test(
    normalized,
  );
}

function cleanPath(raw: string, projectRoot: string): string {
  let value = raw.trim().replace(/^`+|`+$/g, '');
  value = value.replace(/[),;]+$/g, '');

  const normalizedValue = value.replaceAll('\\', '/');
  const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const windowsStyle = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableValue = windowsStyle ? normalizedValue.toLowerCase() : normalizedValue;
  const comparableRoot = windowsStyle ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (comparableValue.startsWith(`${comparableRoot}/`)) {
    value = normalizedValue.slice(normalizedRoot.length + 1);
  }

  return value || '.';
}

/**
 * Compatibility parser for local models that print shell commands instead of
 * returning structured tool calls. It intentionally recognizes read-only
 * inspection commands only; arbitrary shell text is never executed.
 */
export function parseTextReadToolCalls(
  content: string,
  projectRoot: string,
): TextReadToolCall[] {
  const source = content
    .replace(/```(?:bash|sh|shell|powershell|pwsh|cmd)?/gi, '\n')
    .replace(/```/g, '\n');

  // Avoid treating ordinary prose that happens to mention "cat" or "dir" as
  // a command. The screenshot patterns either start a command line, use a
  // shell chain, or contain an option-bearing `ls` command.
  const looksOperational =
    /(^|\n)\s*(?:cd|ls|dir|get-childitem|cat|type|get-content|grep|rg|select-string|findstr)\b/im.test(source) ||
    /(?:&&|;)\s*(?:cd|ls|dir|get-childitem|cat|type|get-content|grep|rg|select-string|findstr)\b/i.test(source) ||
    /\bls\s+-[a-z]/i.test(source);
  if (!looksOperational) return [];

  const calls: TextReadToolCall[] = [];
  const seen = new Set<string>();
  const add = (call: TextReadToolCall) => {
    const key = `${call.name}:${JSON.stringify(call.args)}`;
    if (!seen.has(key) && calls.length < MAX_FALLBACK_CALLS) {
      seen.add(key);
      calls.push(call);
    }
  };

  if (/(^|[\s;&|])(?:ls|dir|get-childitem)(?=\s|$)/i.test(source)) {
    add({ name: 'list_directory', args: { path: '.', maxDepth: 3 } });
  }

  // cat/type/Get-Content may be repeated in a flattened model response such
  // as "cd root && cat package.json cd root && cat README.md".
  const readPattern = /(?:^|[\s;&|])(?:cat|type|get-content)\s+(?:-[^\s;&|]+\s+)*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;
  for (const match of source.matchAll(readPattern)) {
    const path = cleanPath(match[1] ?? match[2] ?? match[3] ?? '', projectRoot);
    if (
      path &&
      path !== '.' &&
      !/^(?:cd|ls|dir|get-childitem|cat|type|get-content|grep|rg|select-string|findstr)$/i.test(path)
    ) {
      add({ name: 'read_file', args: { path } });
    }
  }

  addSearchCalls(source, add);

  return calls;
}
