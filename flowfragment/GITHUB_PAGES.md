# GitHub Pages 公開

このフォルダの内容をそのままリポジトリへ配置すると、静的サイトとして動作します。

1. `index.html`、`styles.css`、`app.js`、`.nojekyll`、`default-flow.json` をリポジトリへ追加
2. GitHub の `Settings` → `Pages` を開く
3. `Deploy from a branch` を選択
4. 公開するブランチと `/ (root)` を選択して保存

初回アクセス時は、アプリ内蔵のサンプルフローが表示されます。`default-flow.json` は配布・動作確認用の同内容サンプルです。

「最近のファイル」「保存」「別名保存」は、HTTPSで配信されるGitHub PagesとChromium系ブラウザの組み合わせで利用できます。未対応ブラウザではJSONのダウンロードとアップロードへ切り替わります。
