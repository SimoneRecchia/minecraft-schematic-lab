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

test('runs the redstone live: a switch in the panel lights the lamp', async ({ page, request }) => {
  const circuit = {
    name: 'E2E Lamp',
    minecraftVersion: '1.21.4',
    operations: [
      { id: 'floor', type: 'box', from: [0, -1, 0], to: [5, -1, 0], block: 'smooth_stone' },
      { id: 'lever', type: 'blocks', block: 'lever[face=floor,facing=east]', at: [[0, 0, 0]] },
      { id: 'delay', type: 'blocks', block: 'repeater[facing=west,delay=4]', at: [[1, 0, 0]] },
      { id: 'dust', type: 'line', from: [2, 0, 0], to: [3, 0, 0], block: 'redstone_wire' },
      { id: 'lamp', type: 'blocks', block: 'redstone_lamp', at: [[4, 0, 0]] },
    ],
    circuit: {
      inputs: { S: { at: [0, 0, 0] } },
      outputs: { L: { at: [4, 0, 0] } },
      tests: [{ name: 'lights', steps: [{ set: { S: 1 } }, { expect: { L: 1 }, within: 10 }] }],
    },
  };
  const res = await request.post('/api/build', { data: { spec: circuit } });
  expect(((await res.json()) as { summary: string }).summary).toContain('Tests: 1/1 passed');
  await page.goto('/');
  await page.getByRole('button', { name: 'Redstone' }).click();
  await expect(page.locator('.io-row')).toHaveCount(2);
  await expect(page.locator('.io-row .led')).not.toHaveClass(/on/);
  await page.getByRole('switch').click();
  // The repeater waits 8 game ticks (0.4 s at real speed), then the lamp lights.
  await expect(page.locator('.io-row .led')).toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('.simbar .clock')).toContainText(/\d/);
  await page.getByRole('button', { name: /Run all|Esegui tutti/ }).click();
  await expect(page.locator('.status-dot.pass')).toHaveCount(1);
});

test('a right-click in the scene flips the lever; the labels can be hidden', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Redstone' }).click();
  await expect(page.locator('.io-label')).toHaveCount(2);
  // Frame the lever, then right-click the middle of the scene, like in the game.
  await page.locator('.io-name', { hasText: /^S$/ }).click();
  await page.waitForTimeout(800);
  const box = (await page.locator('.scene canvas').boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 8, y - 8);
  await page.mouse.move(x, y, { steps: 4 });
  await expect(page.locator('.scene')).toHaveClass(/can-use/);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.io-row .led')).toHaveClass(/on/, { timeout: 5000 });
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  await expect(page.locator('.io-label')).toHaveCount(0);
  await page.keyboard.press('i');
  await expect(page.locator('.io-label')).toHaveCount(2);
});

test('imports a schematic as a site to build on', async ({ page, request }) => {
  const schem = await request.get('/api/export/schem');
  expect(schem.ok()).toBe(true);
  await page.goto('/');
  await page.locator('.sidebar-head button[title]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /From a schematic|Da una schematica/ }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'cottage.schem',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await schem.body()),
  });
  await expect(page.locator('.build-name')).toHaveText('cottage');
  await expect(page.locator('.site-card')).toContainText('cottage.schem');
  const header = await (await request.get('/api/build')).json();
  expect(header.build.site).toMatchObject({ kind: 'schematic', changes: 0 });
});
