export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  capabilities: string[];
  icon: string;
}

export const MODEL_METADATA: Record<string, ModelInfo> = {
  'x/flux2-klein:latest': {
    name: 'x/flux2-klein:latest',
    displayName: 'Flux.2 Klein',
    description: 'High-quality image generation and vision capabilities.',
    capabilities: ['Vision', 'Text-to-Image', 'Multimodal'],
    icon: '🎨',
  },
  'gemma4:e4b': {
    name: 'gemma4:e4b',
    displayName: 'Gemma 4',
    description: 'Google\'s lightweight yet powerful model for general tasks.',
    capabilities: ['General', 'Reasoning'],
    icon: '💎',
  },
  'qwen3.5:latest': {
    name: 'qwen3.5:latest',
    displayName: 'Qwen 3.5',
    description: 'Alibaba\'s advanced model, excellent for coding and math.',
    capabilities: ['Coding', 'Math', 'Instruction Following'],
    icon: '🏮',
  },
  'llama3.1:8b': {
    name: 'llama3.1:8b',
    displayName: 'Llama 3.1',
    description: 'Meta\'s latest open-weight model with long context.',
    capabilities: ['General', 'Long Context', 'Knowledge'],
    icon: '🦙',
  },
};

export const getModelInfo = (modelName: string | null | undefined): ModelInfo => {
  const name = modelName || '';
  return (
    MODEL_METADATA[name] || {
      name: name,
      displayName: name ? name.split(':')[0] : 'Select Model',
      description: 'Ollama model',
      capabilities: [],
      icon: '🤖',
    }
  );
};
