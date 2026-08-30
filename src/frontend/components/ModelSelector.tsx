import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './ModelSelector.css';
import { getModelInfo, getProviderDisplayInfo } from '../config/modelMetadata';
import type { ModelMetadataMap } from '../config/modelMetadata';

interface ModelSelectorProps {
  availableModels: string[];
  modelMetadata: ModelMetadataMap;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onRefresh?: () => void;
  providers?: Array<{ name: string; provider: string; providerLabel?: string }>;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedProvider = providers?.find((p) => p.name === selectedModel)?.provider;
  const providerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const model of availableModels) {
      const entry = providers?.find((provider) => provider.name === model);
      if (entry) labels.set(entry.provider, entry.providerLabel || getProviderDisplayInfo(entry.provider).label);
    }
    return labels;
  }, [availableModels, providers]);

  const getProviderLabel = useCallback((provider: string) =>
    providerLabels.get(provider) || getProviderDisplayInfo(provider).label, [providerLabels]);
  const selectedInfo = getModelInfo(selectedModel, modelMetadata[selectedModel], selectedProvider);

  // Group all available models by provider
  const allGrouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const model of availableModels) {
      const provider = providers?.find((p) => p.name === model)?.provider ?? 'ollama';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(model);
    }
    return groups;
  }, [availableModels, providers]);

  // Filter models by selected provider and search query
  const filteredGrouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    const query = searchQuery.trim().toLowerCase();

    for (const [provider, models] of allGrouped.entries()) {
      if (providerFilter !== 'all' && provider !== providerFilter) continue;

      const matchedModels = models.filter((model) => {
        if (!query) return true;
        const info = getModelInfo(model, modelMetadata[model], provider);
        const providerName = getProviderLabel(provider).toLowerCase();
        return (
          model.toLowerCase().includes(query) ||
          info.displayName.toLowerCase().includes(query) ||
          info.description.toLowerCase().includes(query) ||
          providerName.includes(query) ||
          info.capabilities.some((c) => c.toLowerCase().includes(query))
        );
      });

      if (matchedModels.length > 0) {
        groups.set(provider, matchedModels);
      }
    }
    return groups;
  }, [allGrouped, providerFilter, searchQuery, modelMetadata, getProviderLabel]);

  const hasMultipleProviders = allGrouped.size > 1;

  const toggleDropdown = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setSearchQuery('');
      if (onRefresh) onRefresh();
      setTimeout(() => searchInputRef.current?.focus(), 50);
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
        <div className="model-selector__current">
          <span className="model-selector__name">{selectedInfo.displayName}</span>
          <span className="model-selector__badge-container">
            {selectedProvider && (
              <span className="model-selector__provider-tag">
                {getProviderLabel(selectedProvider)}
              </span>
            )}
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
          {/* Header Search & Filter */}
          <div className="model-selector__header">
            <div className="model-selector__search-box">
              <svg className="model-selector__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                className="model-selector__search-input"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="model-selector__search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              )}
            </div>

            {hasMultipleProviders && (
              <div className="model-selector__filter-tabs">
                <button
                  type="button"
                  className={`model-selector__filter-tab ${providerFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setProviderFilter('all')}
                >
                  All ({availableModels.length})
                </button>
                {Array.from(allGrouped.entries()).map(([provider, models]) => {
                  return (
                    <button
                      key={provider}
                      type="button"
                      className={`model-selector__filter-tab ${providerFilter === provider ? 'is-active' : ''}`}
                      onClick={() => setProviderFilter(provider)}
                    >
                      <span>{getProviderLabel(provider)}</span>
                      <span className="model-selector__tab-count">({models.length})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Model List */}
          <div className="model-selector__list">
            {availableModels.length === 0 && (
              <div className="model-selector__empty">
                <p className="model-selector__empty-title">No models available</p>
                <p className="model-selector__empty-hint">
                  Connect a provider in Settings, or run <code>ollama pull llama3.2</code> for local models.
                </p>
              </div>
            )}
            {availableModels.length > 0 && filteredGrouped.size === 0 && (
              <div className="model-selector__empty">
                <p className="model-selector__empty-title">No matching models found</p>
                <p className="model-selector__empty-hint">Try adjusting your search query or provider filter.</p>
              </div>
            )}
            {Array.from(filteredGrouped.entries()).map(([provider, models]) => {
              return (
                <div key={provider} className="model-selector__group">
                  {(hasMultipleProviders || providerFilter === 'all') && (
                    <div className="model-selector__group-header">
                      <span className="model-selector__group-label">
                        {getProviderLabel(provider)}
                      </span>
                      <span className="model-selector__group-count">({models.length})</span>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
