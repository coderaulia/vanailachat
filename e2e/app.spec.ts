import { expect, test } from '@playwright/test';

test('app loads, creates a project, opens settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vanaila_onboarding_done', 'true'));
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Chat History' })).toBeVisible();
  await expect(page.getByPlaceholder(/Ask for code, debugging help/)).toBeVisible();

  const name = `E2E project ${Date.now()}`;
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByPlaceholder('New project name').fill(name);
  await page.getByPlaceholder('New project name').press('Enter');
  await expect(page.locator('#project-select option', { hasText: name })).toHaveCount(1);

  await page.getByRole('button', { name: 'Start New Chat' }).click();
  await expect(page.getByPlaceholder(/Ask for code, debugging help/)).toBeEmpty();

  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
});
