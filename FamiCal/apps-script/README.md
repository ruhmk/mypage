# Googleカレンダー表示用 Apps Script

家族用Googleカレンダーを作らず、管理用ページが読むための予定データを返します。取得したデータは `data/events.js` としてGitHub Pagesへ反映します。

## 役割

- 仕事用Googleカレンダーは開始/終了だけを読み、画面には `仕事` として返します。
- 仕事用Googleカレンダーの終日予定は除外します。
- 個人Googleカレンダーはタイトルだけを返します。
- 説明、場所、参加者、会議URLは返しません。
- 個人予定をすべて `予定あり` にしたい場合は、`Code.gs` の `PERSONAL_MODE` を `"busy"` にします。

## 設定手順

1. Apps Scriptを作成し、`Code.gs` と `appsscript.json` の内容を貼り付けます。

2. Apps Scriptで「サービス」から `Google Calendar API` を追加します。

3. このApps Scriptを実行するGoogleアカウントに、次のカレンダー権限を持たせます。
   - 仕事用カレンダー: 予定の表示（時間枠のみ、詳細は非表示）以上
   - 個人カレンダー: 予定の表示（すべての予定の詳細）

4. Apps Scriptをウェブアプリとしてデプロイします。
   - 実行するユーザー: 自分
   - アクセスできるユーザー: 自分

5. 発行されたウェブアプリURLを `data/config.js` に貼り付けます。

```js
window.FAMILY_CALENDAR_CONFIG = {
  googleSyncUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
  autoLoadGoogleEvents: false
};
```

これで、`admin.html` から予定を取得できます。

## GitHubへ自動反映する設定

`admin.html` の `GitHubに反映` ボタンを使う場合は、Apps Scriptの「プロジェクトの設定」からスクリプトプロパティを追加します。

```text
GITHUB_TOKEN=GitHubのPersonal access token
GITHUB_OWNER=ruhmk
GITHUB_REPO=ruhmk.github.io
GITHUB_BRANCH=main
GITHUB_EVENTS_PATH=data/events.js
```

GitHubトークンには、対象リポジトリの `Contents` を読み書きできる権限を付けます。トークンは `data/config.js` やGitHub Pages側には置かず、Apps Scriptのスクリプトプロパティだけに保存します。

`appsscript.json` に外部通信の権限を追加しているため、反映後はApps Scriptを保存して再デプロイし、必要に応じて再承認してください。

## 注意

アクセスできるユーザーを「自分」にすると、Google予定を取得できるのは更新者だけです。

家族はApps Scriptへアクセスせず、GitHub Pages上の `data/events.js` だけを見ます。個人予定のタイトルを公開範囲に含めたくない場合は、`Code.gs` の `PERSONAL_MODE` を `"busy"` にしてください。
