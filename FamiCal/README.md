# 家族カレンダー

GitHub Pagesにそのまま置ける静的カレンダーです。家族向けの `index.html` は `data/events.js` だけを読み込む表示専用画面です。

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

## 更新方法

管理用の [admin.html](<C:/Users/S18344/Documents/Codex/2026-05-27/nasca-google/admin.html>) を開きます。

1. `Google予定を取得` を押します。
2. 取得結果を確認します。
3. `events.jsを保存` を押します。
4. 保存した `events.js` を `data/events.js` に置き換えます。
5. GitHubへ反映します。

家族は [index.html](<C:/Users/S18344/Documents/Codex/2026-05-27/nasca-google/index.html>) を見るだけです。Googleログインは不要です。

## Googleカレンダー連携の方針

- 家族はGitHub Pagesを見るだけにする
- 表示用データは、Googleカレンダーから公開してよい形に整えたJSONにする
- カレンダーへの予定登録はGoogleカレンダー/NASCA側で行う
- GitHub Pagesには取り込み済みの `data/events.js` だけを置く

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
  autoLoadGoogleEvents: true
};
```

これで `admin.html` からGoogle予定を取得できます。

この方式では、家族用Googleカレンダーは不要です。

## 家族がログインなしで見る設定

家族向けの `index.html` はGoogleに接続しません。公開済みの `data/events.js` だけを見るので、家族側のGoogleログインは不要です。

`admin.html` は更新者用です。Apps Scriptのアクセスを「自分」にしておけば、Google予定を取得できるのは更新者だけです。

注意: `data/events.js` はGitHub Pagesで公開されます。仕事予定は `仕事` だけ、NASCAの終日予定は除外されます。個人予定のタイトルも公開範囲に含めたくない場合は、`apps-script/Code.gs` の `PERSONAL_MODE` を `"busy"` にしてください。
