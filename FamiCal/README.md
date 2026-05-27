# 家族カレンダー

GitHub Pagesにそのまま置ける静的カレンダーです。今は `data/events.js` を読み込み、画面から追加した予定はブラウザ内に保存します。

## ローカル表示

`index.html` をダブルクリックして開きます。

## 予定データ

`data/events.js` の形に合わせて、あとからGoogleカレンダーやNASCA同期処理の出力を差し替えます。

```js
window.FAMILY_CALENDAR_EVENTS = [
  {
    id: "unique-id",
    title: "仕事",
    start: "2026-05-27T00:00:00.000Z",
    end: "2026-05-27T09:00:00.000Z",
    source: "work",
    note: ""
  }
];
```

`source` は `family`, `personal`, `work` のいずれかです。NASCA由来の予定は `title` を `仕事`、`note` を空にします。

## Googleカレンダー連携の方針

- 家族はGitHub Pagesを見るだけにする
- 表示用データは、Googleカレンダーから公開してよい形に整えたJSONにする
- ページ上の「Googleで作成」はGoogleカレンダーの予定作成画面を開く
- 完全自動でGoogleカレンダーへ書き込む場合は、GitHub PagesではなくApps Scriptや小さなバックエンド側で処理する

GitHub Pagesは公開される前提なので、秘密情報や更新トークンは置かないでください。

## 今回のGoogle同期構成

次の形を想定しています。

```text
NASCA
  -> 仕事用Googleカレンダー
  -> Apps Scriptが「仕事」だけに変換

respectinspire0805@gmail.com の個人Googleカレンダー
  -> Apps Scriptがタイトルだけ、または「予定あり」に変換

GitHub Pages
  -> Apps Scriptの表示用データだけ読む
```

同期処理は [apps-script/Code.gs](<C:/Users/S18344/Documents/Codex/2026-05-27/nasca-google/apps-script/Code.gs>) にあります。セットアップ手順は [apps-script/README.md](<C:/Users/S18344/Documents/Codex/2026-05-27/nasca-google/apps-script/README.md>) を見てください。

Apps Scriptをデプロイしたら、発行されたURLを [data/config.js](<C:/Users/S18344/Documents/Codex/2026-05-27/nasca-google/data/config.js>) に入れます。

```js
window.FAMILY_CALENDAR_CONFIG = {
  googleSyncUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
  autoLoadGoogleEvents: false
};
```

これで画面右上の「Google予定を更新」ボタンが使えるようになります。

この方式では、家族用Googleカレンダーは不要です。
