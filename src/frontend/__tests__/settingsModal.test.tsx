// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import * as ChatContext from '../context/ChatContext';
import { SettingsModal } from '../components/SettingsModal';
import {
  customProviderWrites,
  detectLlmMode,
  normalizeSettings,
  parseCustomProviders,
} from '../components/settings/useSettingsStore';

describe('settings helpers', () => {
  it('detects the provider tab from saved keys', () => {
    expect(detectLlmMode({})).toBe('ollama');
    expect(detectLlmMode({ openrouter_api_key: 'k' })).toBe('openrouter');
    expect(detectLlmMode({ custom_openai_base_url: 'http://x' })).toBe('custom');
    expect(detectLlmMode({ nine_router_api_key: 'k' })).toBe('9router');
    expect(detectLlmMode({ openai_api_key: 'k' })).toBe('openai');
    expect(detectLlmMode({ openai_api_key: 'k', openai_base_url: 'https://openrouter.ai/api/v1' })).toBe('openrouter');
  });

  it('fills defaults and moves a legacy OpenRouter key out of the OpenAI slot', () => {
    const out = normalizeSettings({ openai_api_key: 'sk-or', openai_base_url: 'https://openrouter.ai/api/v1', coding_harness: 'bogus' });
    expect(out.ollama_host).toBe('http://localhost:11434');
    expect(out.coding_harness).toBe('pi-harness');
    expect(out.openrouter_api_key).toBe('sk-or');
    expect(out.openai_api_key).toBe('');
  });

  it('parses custom providers from the list, legacy keys, or a default', () => {
    expect(parseCustomProviders({ custom_openai_providers: JSON.stringify([{ id: 'a', name: 'A', baseUrl: 'u' }]) })[0].id).toBe('a');
    expect(parseCustomProviders({ custom_openai_base_url: 'http://legacy' })[0].baseUrl).toBe('http://legacy');
    expect(parseCustomProviders({ custom_openai_providers: 'not json' })).toHaveLength(1);
  });

  it('mirrors the first custom provider into the legacy keys', () => {
    const writes = customProviderWrites([{ id: 'a', name: 'A', baseUrl: ' http://a ', apiKey: ' k ', models: 'm' }]);
    expect(Object.fromEntries(writes)).toMatchObject({
      custom_openai_base_url: 'http://a',
      custom_openai_api_key: 'k',
      custom_openai_models: 'm',
    });
  });
});

describe('SettingsModal', () => {
  let updateSetting: MockInstance<typeof api.apiUpdateSetting>;

  beforeEach(() => {
    vi.spyOn(api, 'apiFetchSettings').mockResolvedValue({ user_name: 'Alex', require_tool_approval: 'true' });
    updateSetting = vi.spyOn(api, 'apiUpdateSetting').mockResolvedValue();
    vi.spyOn(ChatContext, 'useChat').mockReturnValue({
      isDarkMode: true,
      toggleTheme: vi.fn(),
    } as unknown as ReturnType<typeof ChatContext.useChat>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads saved values into the personalization tab', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Personalization/ }));
    expect((screen.getByPlaceholderText('e.g. Alex') as HTMLInputElement).value).toBe('Alex');
  });

  it('keeps edits when switching tabs and saves them trimmed', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Personalization/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Alex'), { target: { value: ' Sam ' } });

    fireEvent.click(screen.getByRole('tab', { name: /About/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Personalization/ }));
    expect((screen.getByPlaceholderText('e.g. Alex') as HTMLInputElement).value).toBe(' Sam ');

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('user_name', 'Sam'));
  });

  it('flushes a pending edit when the modal closes before the autosave delay', async () => {
    const { unmount } = render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Personalization/ }));
    fireEvent.change(screen.getByPlaceholderText(/Software engineer/), { target: { value: 'Designer' } });
    expect(updateSetting).not.toHaveBeenCalled();

    act(() => unmount());
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('user_role', 'Designer'));
  });

  it('saves toggles immediately', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Behaviour/ }));
    fireEvent.click(screen.getByLabelText('Ask before making changes'));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('require_tool_approval', 'false'));
  });

  it('does not save invalid pricing JSON', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Behaviour/ }));
    const pricing = screen.getByPlaceholderText(/deepseek-v4-flash/);
    fireEvent.change(pricing, { target: { value: '{ broken' } });
    fireEvent.blur(pricing);
    expect(await screen.findByText(/Not saved/)).toBeDefined();
    expect(updateSetting).not.toHaveBeenCalledWith('model_pricing', expect.anything());
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
