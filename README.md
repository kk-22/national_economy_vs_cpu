# ナショナルエコノミー vs CPU

ボードゲーム「ナショナルエコノミー」の非公式ブラウザアプリです。  
人間1人 vs CPU（1〜3体）で遊べます。

**本アプリは http://spa-game.com/?page_id=4242 に基づいて作成したナショナルエコノミーの非公式アプリです。**  

## 遊び方

- [GitHub Pages でプレイ](https://kk-22.github.io/national_economy_vs_cpu/)

## 技術スタック

- Vue 3 (Composition API / `<script setup>`)
- TypeScript
- Vite
- Plain CSS

## ローカル開発

```bash
npm install
npm run dev      # 開発サーバー起動 (localhost:5173)
npm run build    # 本番ビルド
npm run test     # ユニットテスト
```

## デプロイ

GitHub Pages（`gh-pages` ブランチ）へのデプロイ：

```bash
npm run deploy
```

ビルドと gh-pages ブランチへの公開が自動で行われます。

