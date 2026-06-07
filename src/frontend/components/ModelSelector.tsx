import { useState, useRef, useEffect, useMemo } from 'react';
import './ModelSelector.css';
import { getModelInfo, PROVIDER_DISPLAY } from '../config/modelMetadata';
import type { ModelMetadataMap } from '../config/modelMetadata';

interface ModelSelectorProps {
  availableModels: string[];
  modelMetadata: ModelMetadataMap;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onRefresh?: () => void;
  providers?: Array<{ name: string; provider: string }>;
}

export function ModelSelector({
  availableModels,
  modelMetadata,
  selectedModel,
  onSelectModel,
  onRefresh,
  providers,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedProvider = providers?.find((p) => p.name === selectedModel)?.provider;
  const selectedInfo = getModelInfo(selectedModel, modelMetadata[selectedModel], selectedProvider);

  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const model of availableModels) {
      const provider = providers?.find((p) => p.name === model)?.provider ?? 'ollama';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(model);
    }
    return groups;
  }, [availableModels, providers]);

  const hasMultipleProviders = grouped.size > 1;

  const toggleDropdown = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState && onRefresh) {
      onRefresh();
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        type="button"
        className={`model-selector__trigger ${isOpen ? 'is-open' : ''}`}
        onClick={toggleDropdown}
      >
        <span className="model-selector__icon">{selectedInfo.icon}</span>
        <div className="model-selector__current">
          <span className="model-selector__name">{selectedInfo.displayName}</span>
          <span className="model-selector__badge-container">
            {selectedInfo.capabilities.map((cap) => (
              <span key={cap} className="model-selector__badge">
                {cap}
              </span>
            ))}
          </span>
        </div>
        <svg
          className={`model-selector__arrow ${isOpen ? 'is-flipped' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="model-selector__dropdown">
          <div className="model-selector__list">
            {availableModels.length === 0 && (
              <div className="model-selector__empty">
                <span className="model-selector__empty-icon">🤖</span>
                <p className="model-selector__empty-title">No models available</p>
                <p className="model-selector__empty-hint">
                  Connect a provider in Settings, or run <code>ollama pull llama3.2</code> for local models.
                </p>
              </div>
            )}
            {Array.from(grouped.entries()).map(([provider, models]) => (
              <div key={provider} className="model-selector__group">
                {hasMultipleProviders && (
                  <div className="model-selector__group-header">
                    <span className="model-selector__group-icon">
                      {PROVIDER_DISPLAY[provider]?.icon ?? '🤖'}
                    </span>
                    <span className="model-selector__group-label">
                      {PROVIDER_DISPLAY[provider]?.label ?? provider}
                    </span>
                  </div>
                )}
                {models.map((model) => {
                  const info = getModelInfo(model, modelMetadata[model], provider);
                  const isActive = model === selectedModel;
                  return (
                    <button
                      key={model}
                      type="button"
                      className={`model-selector__option ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        onSelectModel(model);
                        setIsOpen(false);
                      }}
                    >
                      <span className="model-selector__option-icon">{info.icon}</span>
                      <div className="model-selector__option-content">
                        <div className="model-selector__option-header">
                          <span className="model-selector__option-name">{info.displayName}</span>
                          {isActive && (
                            <svg className="model-selector__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <p className="model-selector__option-desc">{info.description}</p>
                        <div className="model-selector__option-badges">
                          {info.capabilities.map((cap) => (
                            <span key={cap} className="model-selector__option-badge">
                              {cap}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
