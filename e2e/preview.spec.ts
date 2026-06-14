import { expect, test } from '@playwright/test';

test('viewer loads with the Claude hint and an empty preview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('minecraft-schematic-lab')).toBeVisible();
  await expect(page.getByText('Driven by Claude')).toBeVisible();
  await expect(page.getByText('Ask Claude to build something — it')).toBeVisible();
});

test('camera preset chips are present', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Isometric' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Front' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Top' })).toBeVisible();
});
