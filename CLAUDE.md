# National Economy vs CPU

ボードゲーム「ナショナルエコノミー」のブラウザ実装。1人 vs CPU（1〜3体）で遊べる。

## 技術スタック

| 項目 | 採用 |
|------|------|
| フレームワーク | Vue 3 (Composition API) |
| 言語 | TypeScript |
| ビルドツール | Vite |
| スタイリング | Plain CSS |
| テスト | Vitest |
| ホスティング | GitHub Pages |

## 開発コマンド

```bash
npm install          # 依存関係インストール
npm run dev          # 開発サーバー起動 (localhost:5173)
npm run build        # 本番ビルド (dist/)
npm run preview      # ビルド結果のローカル確認
npm run test         # Vitestでユニットテスト
npm run deploy       # GitHub Pagesへデプロイ (gh-pages -d dist)
```

## ディレクトリ構成

```
national_ecnomy_vs_cpu/
├── CLAUDE.md
├── docs/
│   ├── rules.md           # ゲームルール全文
│   └── building-cards.md  # カード一覧・効果
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── game/              # ゲームロジック（Vue依存なし・純粋TS）
│   │   ├── types.ts       # 型定義
│   │   ├── constants.ts   # カードデータ・定数
│   │   ├── actions.ts     # 合法手の列挙・実行
│   │   ├── rules.ts       # ルール判定・ラウンド進行
│   │   └── cpu.ts         # CPUロジック
│   ├── composables/       # Vue Composables（状態管理）
│   │   └── useGame.ts
│   └── components/        # Vueコンポーネント
│       ├── Board.vue
│       ├── PlayerArea.vue
│       ├── CardComponent.vue
│       └── RoundInfo.vue
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## ゲーム概要

- **ラウンド数**: 9ラウンド固定
- **プレイヤー**: 人間1人 + CPU 1〜3体
- **勝利条件**: 最終得点（建物コスト合計 + 残金）が最高
- **CPUロジック**: 合法手からランダム選択（弱AI）

## 重要なルール

- 毎ラウンド末に賃金支払い（ラウンドカードの賃金 × 労働者数）
- 支払えない場合は建物をお払い箱（公共施設）に送る
- お金はゲーム内で循環（サプライが空なら誰も受け取れない）
- 詳細は `docs/rules.md` 参照

## カードデータ

- `docs/building-cards.md` に一覧あり（TODO項目は要確認）
- ゲーム内では `src/game/constants.ts` にTypeScriptオブジェクトとして定義する

## 作業ルール

- **コミットはユーザーが明示的に指示した場合のみ行うこと。実装・動作確認まで行い、コミットは待つ。**
- **コード変更後の確認は `npm run build`（ビルド成功）のみでよい。ブラウザでの動作確認はしないこと。**

## デプロイ

```bash
npm run build
npx gh-pages -d dist
```

GitHub Pagesの設定でブランチを `gh-pages` に設定すること。
