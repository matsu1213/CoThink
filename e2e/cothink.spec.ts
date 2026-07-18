import { test, expect } from '@playwright/test';

test('selection review stays in context, speaks through companion, and persists', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'はじめる'}).click();
  await page.getByRole('button', {name: '最初のノートを作成'}).click();
  await page.getByLabel('ノートタイトル').fill('E2E思考メモ');
  const editor = page.locator('.tiptap');
  await editor.fill('使いやすい体験を設計する。');
  await page.waitForTimeout(800);
  await editor.selectText();

  const menu = page.getByRole('toolbar', {name: '選択範囲をAIレビュー'});
  await expect(menu.getByRole('button', {name: '具体化'})).toBeVisible();
  await menu.getByRole('button', {name: '具体化'}).click();
  await expect(page.getByRole('heading', {name: 'AIレビュー'})).not.toBeVisible();

  const bubble = page.locator('.companion-bubble');
  await expect(bubble).toBeVisible();
  await expect(page.locator('.comments article').first()).toContainText('判断基準');
  await bubble.locator('.bubble-lead').click();
  await expect(bubble).toContainText('なぜ重要か');
  await bubble.getByRole('button', {name: '解決'}).click();

  await page.reload();
  await expect(page.getByLabel('ノートタイトル')).toHaveValue('E2E思考メモ');
});

test('proactive mode lets AI nominate a comment location after an idle period', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'はじめる'}).click();
  await page.getByRole('button', {name: '最初のノートを作成'}).click();
  await page.getByRole('button', {name: '設定'}).click();
  await page.getByRole('radio', {name: /積極的/}).check();
  await page.getByRole('button', {name: '保存'}).click();
  await expect(page.getByText('設定を保存しました。外部サービスには送信しません。')).toBeVisible();
  await page.getByRole('button', {name: '設定を閉じる'}).click();

  const editor = page.locator('.tiptap');
  await editor.fill('この計画では、利用者が毎日この機能を使うという前提を置いています。しかし、実際の利用頻度を確認する調査結果はまだなく、前提から結論までの根拠が十分に文章化されていません。そこで実装を先に進めるべきだと考えています。');
  await expect(page.locator('.companion-bubble')).toBeVisible({timeout: 15_000});
  await expect(page.locator('.comments article').first()).toContainText('判断基準');
});
