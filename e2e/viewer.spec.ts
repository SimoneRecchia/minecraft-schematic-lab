import { expect, test } from '@playwright/test';

const spec = {
  name: 'E2E Cottage',
  minecraftVersion: '1.21.4',
  operations: [
    { id: 'walls', type: 'box', from: [0, 0, 0], to: [8, 4, 6], block: 'oak_planks', walls: true },
    {
      id: 'roof',
      type: 'roof',
      shape: 'gable',
      from: [0, 5, 0],
      to: [8, 5, 6],
      block: 'spruce_stairs',
    },
  ],
};

test('shows the empty state, then a build pushed by Claude', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.empty')).toBeVisible();
  const res = await request.post('/api/build', { data: { spec } });
  expect(res.ok()).toBe(true);
  await expect(page.locator('.build-name')).toHaveText('E2E Cottage');
  await expect(page.locator('.empty')).toBeHidden();
  await expect(page.locator('.scene canvas')).toBeVisible();
  await expect(page.locator('.status')).toContainText(/\d/);
});

test('renders views for Claude through the open viewer', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.build-name')).toHaveText('E2E Cottage');
  await page.waitForTimeout(1500);
  const png = await request.get('/api/render.png?views=iso,top&size=320');
  expect(png.ok()).toBe(true);
  expect((await png.body()).length).toBeGreaterThan(5000);
});

test('export sheet lists the formats for the version', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Export|Esporta/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('WorldEdit .schem', { exact: true })).toBeVisible();
  await expect(page.getByText('Litematica', { exact: true })).toBeVisible();
});

test('history records edits', async ({ page, request }) => {
  await request.post('/api/build/edit', {
    data: {
      edits: [{ op: 'update', id: 'roof', set: { block: 'dark_oak_stairs' } }],
      label: 'darker roof',
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Versions|Versioni/ }).click();
  await expect(page.getByText(/darker roof/)).toBeVisible();
});
