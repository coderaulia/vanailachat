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

  const open = async (props: { onClose?: () => void } = {}) => {
    const view = render(<SettingsModal onClose={props.onClose ?? vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    return view;
  };

  it('saves valid pricing as you type and keeps it when the modal closes at once', async () => {
    const { unmount } = await open();
    fireEvent.click(screen.getByRole('tab', { name: /Behaviour/ }));
    fireEvent.change(screen.getByPlaceholderText(/deepseek-v4-flash/), { target: { value: '{"a":{"input":1,"output":2}}' } });
    act(() => unmount());
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('model_pricing', '{"a":{"input":1,"output":2}}'));
  });

  it('flags broken pricing while typing without saving it', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Behaviour/ }));
    fireEvent.change(screen.getByPlaceholderText(/deepseek-v4-flash/), { target: { value: '{ nope' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not saved yet/);
    expect(updateSetting).not.toHaveBeenCalledWith('model_pricing', expect.anything());
  });

  it('reports a failed save as an error, without a success tick', async () => {
    updateSetting.mockRejectedValue(new Error('disk full'));
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Behaviour/ }));
    fireEvent.click(screen.getByLabelText('Ask before making changes'));
    const badge = await screen.findByRole('alert');
    expect(badge.textContent).toBe('⚠ Not saved — disk full');
    expect(badge.textContent).not.toContain('✓');
  });

  it('puts focus inside the dialog, keeps Tab in it and moves between tabs with the arrow keys', async () => {
    await open();
    const first = screen.getByRole('tab', { name: /AI Connection/ });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Personalization/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Personalization/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /About/ }).getAttribute('aria-selected')).toBe('true');

    // Shift+Tab on the first control wraps to the last one instead of leaving the dialog.
    const dialog = screen.getByRole('dialog');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href]')].filter((el) => el.tabIndex >= 0);
    focusable[0].focus();
    fireEvent.keyDown(focusable[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it('shows a masked key as saved and hidden', async () => {
    vi.spyOn(api, 'apiFetchSettings').mockResolvedValue({ openai_api_key: '••••abcd' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }));
    expect(screen.getByText(/ending in abcd/)).toBeDefined();
    expect((screen.getByPlaceholderText('sk-...') as HTMLInputElement).value).toBe('••••abcd');
  });

  it('tests only the provider being edited', async () => {
    const providers = vi.spyOn(api, 'apiListModelProviders').mockResolvedValue([{ name: 'custom:x', provider: 'custom' }]);
    await open();
    fireEvent.click(screen.getByText(/Test Connection/));
    expect(await screen.findByText(/No models from Ollama/)).toBeDefined();
    expect(providers).toHaveBeenCalled();
  });

  it('asks before removing a custom provider', async () => {
    const list = JSON.stringify([
      { id: 'custom', name: 'One', baseUrl: 'http://a' },
      { id: 'custom_2', name: 'Two', baseUrl: 'http://b' },
    ]);
    vi.spyOn(api, 'apiFetchSettings').mockResolvedValue({ custom_openai_providers: list });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await open();
    fireEvent.click(screen.getByText('Remove this provider'));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /One/ })).toBeDefined();
    expect(updateSetting).not.toHaveBeenCalled();

    // The provider being edited (the first) is the one removed.
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('Remove this provider'));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('custom_openai_providers', expect.not.stringContaining('"One"')));
  });
});
