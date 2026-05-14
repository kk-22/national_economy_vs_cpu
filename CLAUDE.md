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

## ゲーム概要

- **ラウンド数**: 9ラウンド固定
- **プレイヤー**: 人間1人 + CPU 1〜3体
- **勝利条件**: 最終得点（建物コスト合計 + 残金）が最高
- **CPUロジック**: 複数戦略を用意
- 詳細は `docs/rules.md` 参照

## カードデータ

- `docs/building-cards.md` に一覧あり
- ゲーム内では `src/game/constants.ts` にTypeScriptオブジェクトとして定義する

## ゲームログの読み方

UI に表示されるログは **新しい行が上・古い行が下** の順（降順）。
ラウンド内のアクション順は下から上に読む。

```
--- ラウンド 2 終了 (家計 $0) --- ← 最新
人間: 露店                       ← 2手目（最後）
CPU: 採石場                      ← 2手目
人間: 学校                       ← 1手目
CPU: 大工                        ← 1手目（最初）
■■ラウンド 2 開始 (家計 $9) ■■    ← 最古
```

## 作業ルール

- **コミットはユーザーが明示的に「コミットして」と指示した場合のみ行うこと。**
  - 実装・ビルド確認まで行い、コミットは必ず待つ。
  - 直前の作業でコミットを指示されていても、次の作業ではリセットして待つ（連続してコミットしない）。
  - 「実装して」「修正して」などの指示にコミットは含まれない。
- **ブラウザでの動作確認はしないこと。ただし人間が確認できるようにビルドと `npm run dev` を行うこと。**
- ファイルの書き込み・読み込みにはpythonを使わない事

## デプロイ

```bash
npm run build
npx gh-pages -d dist
```

GitHub Pagesの設定でブランチを `gh-pages` に設定すること。
