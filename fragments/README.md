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

画面の「Google OAuthクライアントID」には、Google Cloudで作ったWebアプリ用OAuthクライアントのClient IDを入れます。
形は `xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com` のような文字列です。Client Secretは使いません。

最低限の設定:

- Google Drive APIを有効化する
- OAuth同意画面を設定する
- スコープに `https://www.googleapis.com/auth/drive.file` を追加する
- 外部アプリとして使う場合は、自分のGoogleアカウントをテストユーザーに追加する
- OAuthクライアントの種類は「ウェブアプリケーション」にする
- 承認済みJavaScript生成元にGitHub Pagesの origin を入れる

例:

- GitHub Pagesが `https://example.github.io/today-fragments/` の場合: `https://example.github.io`
- ローカル確認用: `http://127.0.0.1:5177`

## GitHub設定

スマホ側だけにGitHubトークンを保存します。公開リポジトリ内の同期ファイルを更新できる権限が必要です。

画面で入力する項目:

- GitHubユーザー/組織
- リポジトリ
- ブランチ
- 同期ファイルパス
- GitHubトークン

初期値の同期ファイルパスは `daily-fragments-sync/data.enc.json` です。

GitHubトークンはFine-grained personal access tokenを推奨します。

最低限の設定:

- Resource owner: GitHub Pagesを置くユーザー/組織
- Repository access: 対象リポジトリだけ
- Repository permissions: `Contents` を `Read and write`
- Expiration: 任意

画面の「GitHubユーザー/組織」はメールアドレスではなく、GitHub URL上の owner です。

例:

- リポジトリURLが `https://github.com/example/today-fragments` の場合
- GitHubユーザー/組織: `example`
- リポジトリ: `today-fragments`
- ブランチ: `main`
- 同期ファイル: `daily-fragments-sync/data.enc.json`

### GitHub 404が出たとき

ほとんどの場合、次のどれかです。

- 「GitHubユーザー/組織」にメールアドレスを入れている
- リポジトリ名が違う
- ブランチ名が違う
- Fine-grained tokenで対象リポジトリを選んでいない
- Fine-grained tokenの `Contents` が `Read and write` になっていない
- 会社/組織リポジトリで、トークン利用が承認待ちになっている

`kitagawa_manabu@qualiarts.jp` のようなメールアドレスではなく、GitHubのリポジトリURLに出てくる名前を入れます。

例:

- `https://github.com/qualiarts/today-fragments`
- GitHubユーザー/組織: `qualiarts`
- リポジトリ: `today-fragments`

### GitHub認証に失敗したとき

日を跨いだ直後に急に出た場合でも、トークン設定画面で有効期限なしになっているなら、アプリ側に入っているGitHub設定かトークン文字列がずれている可能性が高いです。

必要ならGitHubで新しいFine-grained personal access tokenを作り直し、スマホ側の設定に入れ直してください。

- Resource owner: GitHub Pagesを置いているユーザー/組織
- Repository access: `fragments`
- Repository permissions: `Contents` を `Read and write`
- Expiration: 期限切れしにくい日付。組織ポリシーで上限がある場合はそれに従う
- 会社/組織リポジトリの場合: tokenが `pending` になっていないか、組織承認が必要ではないか確認

`ruhmk/mypage` の `open_page` ブランチ内に `fragments` フォルダを置いている場合、アプリのGitHub設定は次の形です。

- GitHubユーザー/組織: `ruhmk`
- リポジトリ: `mypage`
- ブランチ: `open_page`
- 同期ファイル: `fragments/daily-fragments-sync/data.enc.json`

`fragments` はリポジトリ名ではなくフォルダ名なので、「同期ファイル」の先頭に入れます。

設定画面の「GitHub確認」を押すと、リポジトリ、ブランチ、同期ファイルの順に確認します。

## GitHub Pagesへの配置

このフォルダのファイルをGitHub Pagesで公開するリポジトリへ置きます。

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `vendor/`
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
- カード/グループ/線の接続関係
- PCの右クリックドラッグによる線作成
- スマホの2回タップ編集モード
- スマホの入力/詳細パネル開閉
- 個別位置ロックと全体位置ロック
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y とGUIボタンによるUndo/Redo

QR画像の生成は `vendor/qrcode-generator.js`、スマホ側のQR読み取りは `vendor/jsQR.js` を同梱しています。外部CDNがブロックされてもQRの表示/読み取りができるようにするためです。

iOSでPC差分を取り込む時は、「PCから取り込み」を開いた後に必ず「カメラ開始」ボタンを押してください。iOSでは画面を開いた流れで自動的にカメラを起動しようとすると拒否されることがあります。

## 操作メモ

- スマホではカード/グループを2回タップすると編集対象になります
- スマホで未選択のカード/グループに触れてドラッグすると、視点移動として扱います
- 右下の `▤` ボタンで、入力欄と詳細パネルを開閉できます
- PCではカード/グループから右クリックドラッグすると線を作れます
- 線を右クリックすると、実線、点線、破線、波線が順に切り替わります
- スマホでは詳細パネルの「接続開始」を押してから、接続先をタップします
- 線の意味はまず「関連」と「原因」を選べます
- カード/グループの詳細にある「位置をロック」で個別に移動を止められます
- 上部ツールバーの「止」で、全カード/グループを一時的に掴めなくできます
- `Ctrl+Z` で戻る、`Ctrl+Shift+Z` または `Ctrl+Y` で進む
- 上部ツールバーの `↶` / `↷` でも戻る/進むができます

## 更新が反映されない時

今回の版から、ページは新しいファイルを優先して取りに行くようにしています。通常は再読み込みで更新されます。

ただし、古い版をすでに開いていたスマホでは、この修正自体を読み込む最初の1回だけ古いキャッシュが残ることがあります。その場合はURLの最後に `?v=15` を付けて開いてください。

QR読み取りで「QR読取ライブラリを読み込めませんでした」と出る場合は、GitHub Pagesに `vendor/jsQR.js` も一緒に上がっているか確認してください。アプリ側では、同梱ファイルを読み直し、それでもだめな場合はCDNからの読み込みも試します。

## 使いながら調整したい候補

- グループ形状の自由度
- カードの密度やサイズ
- スマホのカメラQR読取の対応ブラウザ
- GitHub認可をトークン入力からDevice Flowへ変更するか
- PCからスマホへの大量差分QRの見せ方
