import { describe, expect, it } from 'vitest';
import { hasToolCalls, toOpenAICompatibleMessage } from '../services/openAICompat.js';

describe('OpenAI-compatible message normalization', () => {
  it('omits empty tool_calls arrays', () => {
    expect(
      toOpenAICompatibleMessage({
        role: 'assistant',
        content: 'Inspecting the project',
        tool_calls: [],
      }),
    ).toEqual({ role: 'assistant', content: 'Inspecting the project' });
  });

  it('preserves non-empty tool calls and tool result IDs', () => {
    const toolCalls = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'create_document', arguments: { filename: 'offer.docx' } },
    }];

    expect(
      toOpenAICompatibleMessage({
        role: 'assistant',
        content: '',
        tool_call_id: 'result-1',
        tool_calls: toolCalls,
      }),
    ).toEqual({
      role: 'assistant',
      content: '',
      tool_call_id: 'result-1',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: {
          name: 'create_document',
          arguments: '{"filename":"offer.docx"}',
        },
      }],
    });
    expect(hasToolCalls(toolCalls)).toBe(true);
    expect(hasToolCalls([])).toBe(false);
  });

  it('serializes object tool-result content for strict gateways', () => {
    expect(
      toOpenAICompatibleMessage({
        role: 'tool',
        content: { kind: 'generated_file', name: 'offer.docx' },
        tool_call_id: 'call-1',
      }),
    ).toEqual({
      role: 'tool',
      content: '{"kind":"generated_file","name":"offer.docx"}',
      tool_call_id: 'call-1',
    });
  });
});
