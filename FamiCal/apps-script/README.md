# Googleカレンダー同期 Apps Script

NASCA同期済みの仕事用Googleカレンダーと、個人Googleカレンダーを、家族用の専用Googleカレンダーへ同期します。

## 重要

家族用Googleカレンダーは、個人Googleカレンダー本体とは別に作ってください。

おすすめ:

- 仕事用Googleカレンダー: NASCA iCalの同期先
- 個人Googleカレンダー: `respectinspire0805@gmail.com`
- 家族用Googleカレンダー: 新しく作る専用カレンダー

## 同期ルール

- 仕事用Googleカレンダーは free/busy だけを読み、家族用には `仕事` として作成します。
- 個人Googleカレンダーはタイトルだけを家族用へコピーします。
- 説明、場所、参加者、会議URLはコピーしません。
- 個人予定をすべて `予定あり` にしたい場合は、`Code.gs` の `PERSONAL_MODE` を `"busy"` にします。

## 設定手順

1. Googleカレンダーで新しいカレンダーを作ります。
   名前例: `家族カレンダー`

2. 家族用カレンダーの設定画面で、カレンダーIDをコピーします。

3. `Code.gs` の `FAMILY_CALENDAR_ID` に貼り付けます。

4. Apps Scriptを作成し、`Code.gs` と `appsscript.json` の内容を貼り付けます。

5. Apps Scriptで「サービス」から `Google Calendar API` を追加します。

6. このApps Scriptを実行するGoogleアカウントに、次の権限を持たせます。
   - 仕事用カレンダー: 予定の表示（時間枠のみ、詳細は非表示）以上
   - 個人カレンダー: 予定の表示（すべての予定の詳細）
   - 家族用カレンダー: 予定の変更

7. Apps Scriptをウェブアプリとしてデプロイします。
   - 実行するユーザー: 自分
   - アクセスできるユーザー: 全員

8. 発行されたウェブアプリURLを `data/config.js` に貼り付けます。

```js
window.FAMILY_CALENDAR_CONFIG = {
  googleSyncUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
  autoLoadGoogleEvents: true
};
```

これで、ページ上の「Google予定を更新」ボタンから手動同期できます。
