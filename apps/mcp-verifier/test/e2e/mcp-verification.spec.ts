import { test, expect } from '@playwright/test';

test('generate and verify MCP tool', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.fill('[data-testid="tool-description"]', 'A tool that fetches weather data');
  await page.click('[data-testid="generate-button"]');

  await page.waitForSelector('[data-testid="state-diagram"]', { timeout: 30000 });

  const diagram = page.locator('[data-testid="state-diagram"]');
  await expect(diagram).toBeVisible();

  const stateInspector = page.locator('[data-testid="state-inspector"]');
  await expect(stateInspector).toBeVisible();
});

test('displays empty state initially', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.locator('text=Generate an MCP tool')).toBeVisible();
});
