# 發票收件匣

在自己電腦上跑的小工具：讀取 Gmail 裡的電子發票信，依雙月期別分頁、顯示未讀、點一下標已讀（同步 Gmail）、自動兌獎。
資料只留在你的電腦，沒有任何第三方伺服器。

## 安裝（Claude Code）

```bash
/plugin marketplace add <擁有者>/<repo名稱>
/plugin install invoice-inbox@invoice-inbox-marketplace
```

私人 repo 需先被邀請為協作者，且電腦上 `gh auth login` 過。

之後對 Claude 說「**幫我設定發票收件匣**」，它會一步步帶你完成（Node、Google 憑證、授權、啟動）。

## 沒有 Claude 的手動步驟

1. 安裝 Node 18 以上（https://nodejs.org）。
2. 把 `plugins/invoice-inbox/skills/invoice-inbox/app/` 整個複製到你想放的地方。
3. 到 Google Cloud 建專案 → 啟用 Gmail API → OAuth 同意畫面（外部、測試中、把自己加為測試使用者）→ 建立「電腦版」OAuth 用戶端 → 下載 JSON，改名 `credentials.json` 放進資料夾。
4. 啟動：Mac 執行 `./start.sh`，Windows 雙擊 `start.bat`，或 `node server.js` 後開 http://localhost:3456 。
5. 網頁上點「授權 Google」，「尚未驗證」警告選「進階 → 前往」。

## 注意

- 授權在「測試中」狀態約 7 天過期，重新點授權即可。
- 需要時才開，不會開機自動啟動；停止用 `stop.sh` / `stop.bat`。
- `credentials.json`、`token.json` 是你的私人憑證，不要傳給別人。
