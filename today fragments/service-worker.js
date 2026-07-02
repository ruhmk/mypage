# Today Fragments

今日あったことを雑に置いて、あとからAIに渡せる形で保つブラウザアプリです。

## 使い方の流れ

1. スマホでGitHub PagesのURLを開く
2. 「スマホで始める」を選ぶ
3. Google Drive接続用のOAuthクライアントID、同期パスワード、GitHub設定を入れる
4. メモを追加する
5. スマホ側で必要な時だけ「GitHub同期」を押す
6. 会社PCでは「PCで使う」を選び、GitHub上の暗号化データと同期パスワードで開く
7. PCで編集した差分はQRでスマホへ渡す

## 保存場所

- スマホの本体データ: Google Driveの `Today Fragments/today-fragments.json`
- PC用データ: GitHubリポジトリ内の暗号化ファイル
- PCの編集中データ: 会社PCのブラウザ内

GitHubに置くデータは暗号化済みです。同期パスワードはコードにもGitHubにも保存しません。

## Google Drive設定

Google CloudでWebアプリ用OAuthクライアントを作り、GitHub PagesのURLを承認済みJavaScript生成元に追加します。

Driveの権限は `drive.file` を使います。アプリが作成/選択したファイルを扱うための権限です。

## GitHub設定

スマホ側だけにGitHubトークンを保存します。公開リポジトリ内の同期ファイルを更新できる権限が必要です。

画面で入力する項目:

- GitHubユーザー/組織
- リポジトリ
- ブランチ
- 同期ファイルパス
- GitHubトークン

初期値の同期ファイルパスは `daily-fragments-sync/data.enc.json` です。

## GitHub Pagesへの配置

このフォルダのファイルをGitHub Pagesで公開するリポジトリへ置きます。

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `icons/`

ビルドは不要です。

## 現在のMVPでできること

- 本文だけでカード追加
- タイトルの後編集
- 2.5D WebGL背景
- カードのドラッグ移動
- 丸みのあるグループ領域の作成/移動/リサイズ
- グループ領域に入ったカードの自動所属
- ゴミ箱、復元、完全削除
- AI向けMarkdown + JSON + 指示文の書き出し
- スマホのDrive自動保存
- スマホからGitHubへ手動同期
- PCでGitHub暗号化データを読み込み
- PC編集差分のQR出力
- スマホでQR取り込み

## 使いながら調整したい候補

- グループ形状の自由度
- カードの密度やサイズ
- スマホのカメラQR読取の対応ブラウザ
- GitHub認可をトークン入力からDevice Flowへ変更するか
- PCからスマホへの大量差分QRの見せ方
