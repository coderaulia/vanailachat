// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../lib/api';
import { UpdateNotice } from '../components/UpdateNotice';

const newer = { current: '0.3.2', latest: '0.4.0', available: true, url: 'https://github.com/coderaulia/vanailachat/releases/tag/v0.4.0' };

describe('UpdateNotice', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('announces a newer release and opens its page', async () => {
    vi.spyOn(api, 'apiCheckForUpdate').mockResolvedValue(newer);
    const open = vi.spyOn(api, 'apiOpenExternal').mockResolvedValue();
    render(<UpdateNotice />);
    expect(await screen.findByText(/0\.4\.0 is available/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(open).toHaveBeenCalledWith(newer.url);
  });

  it('stays hidden when up to date', async () => {
    const check = vi.spyOn(api, 'apiCheckForUpdate').mockResolvedValue({ ...newer, latest: '0.3.2', available: false });
    const { container } = render(<UpdateNotice />);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('checks at most once a day and remembers a dismissed version', async () => {
    const check = vi.spyOn(api, 'apiCheckForUpdate').mockResolvedValue(newer);
    const first = render(<UpdateNotice />);
    fireEvent.click(await screen.findByLabelText('Dismiss update notice'));
    expect(screen.queryByText(/is available/)).toBeNull();
    first.unmount();

    render(<UpdateNotice />);
    expect(check).toHaveBeenCalledTimes(1);

    localStorage.removeItem('vanaila_update_checked_at');
    render(<UpdateNotice />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});
