---
name: invoice-inbox
description: 設定並啟動「發票收件匣」：在本機讀取使用者 Gmail 的電子發票信，依雙月期別分頁、顯示未讀、一鍵標已讀（同步 Gmail）、自動兌獎。當使用者想設定、啟動、更新或排查發票收件匣時使用。
---

# 發票收件匣

本機小伺服器（Node 18+，零依賴）+ Gmail API。資料只留在使用者自己的電腦，不經過任何第三方。
程式檔在本 skill 旁邊的 `app/` 資料夾。**絕不直接在 skill 資料夾裡執行**，要複製到使用者自己的工作資料夾，個人資料才不會被 skill 更新洗掉。

預設工作資料夾：`~/invoice-inbox`（Windows：`%USERPROFILE%\invoice-inbox`）。

## 第一次設定（依序帶使用者做，每步確認再往下）

1. **檢查 Node**：`node -v` 要 18 以上。不足就請使用者到 https://nodejs.org 安裝 LTS，裝完重開終端機再檢查。Mac 若有 nvm，`start.sh` 會自動挑 v20/v22/v24。
2. **複製程式**：把 `app/` 內所有檔案複製到工作資料夾（不存在就建立）。`overrides.json` 是空的 `{}`，保持原樣。
3. **Google Cloud 憑證**（這段只能使用者自己在網頁操作，你負責逐步指引，不要代為點擊、不要請使用者貼出密鑰內容）：
   1. 開 https://console.cloud.google.com ，建立新專案（名稱隨意，例如 invoice-inbox）。
   2. 「API 和服務」→「程式庫」→ 搜尋 **Gmail API** → 啟用。
   3. 「API 和服務」→「OAuth 同意畫面」：使用者類型選「外部」，填應用程式名稱與自己的 email；**在「測試使用者」加入自己的 Gmail**。保持「測試中」狀態即可，不需要送審。
   4. 「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選 **電腦版應用程式（Desktop）** → 建立 → 下載 JSON。
   5. 把下載的檔案改名為 `credentials.json`，放進工作資料夾。
   - 注意：測試中狀態下授權約每 7 天會過期，過期時重新點一次授權即可；這是 Google 對未審核應用的規定。
4. **啟動**：
   - Mac：`./start.sh`（第一次可能要 `chmod +x start.sh stop.sh`）；也可雙擊 `發票收件匣.command`。
   - Windows：雙擊 `start.bat`。
   - 其他：`node server.js` 後開 http://localhost:3456 。
5. **授權**：網頁會顯示步驟，點「授權 Google」。看到「Google 尚未驗證這個應用程式」是正常的（因為是使用者自己建的專案）→「進階」→「前往…（不安全）」→ 同意 Gmail 權限（讀取與修改標籤/已讀）。
6. **標籤**：預設標籤名「發票」，不存在會自動建立。程式也會自動掃描最近 30 天內未歸類、看起來像電子發票的信並貼上該標籤。想換名稱就用環境變數 `INVOICE_LABEL`。
7. 確認網頁出現發票列表。第一次同步會分批讀取（Gmail 有每分鐘配額），多等一會是正常的。

## 日常

- 開啟：再執行一次 `start.sh` / `start.bat`（已在執行會直接開網頁）。停止：`stop.sh` / `stop.bat`。
- 不會開機自動啟動，需要時自己開。
- 通知與分頁標題未讀數只有在伺服器執行且網頁開著時有效。

## 更新

使用者說要更新時：只覆蓋 `server.js`、`index.html`、`start.*`、`stop.*`、`發票收件匣.command`。**不要動** `credentials.json`、`token.json`、`cache.json`、`checked.json`、`autolabel.json`、`overrides.json`。更新後先 `stop` 再 `start`。

## 排查

- `Quota exceeded` / 403：Gmail 每分鐘配額，程式會自動退避重試，等幾分鐘。
- 埠號 3456 被占用：用 `PORT=3457` 環境變數換埠，但 `credentials.json` 的授權重新導向是 `http://localhost:3456/oauth2callback`，換埠需同步在 Google Cloud 的憑證加上新的重新導向 URI。
- `invalid_grant` / 授權失效：刪除 `token.json`，重新點授權。
- 某寄件者的發票沒被讀到：看 `server.log` 與 `autolabel.json`；程式的自動歸類是保守的白名單規則，必要時可到 `server.js` 的 `SENDER_OK` / `SUBJ_OK` 增補。
- 兌獎資料來自財政部公開 RSS，抓不到時用上次的快取。公司統編發票不能兌獎；增開六獎需自行比對末三碼。

## 隱私原則

- 不要把 `credentials.json`、`token.json`、`cache.json` 的內容貼到對話中或上傳到任何地方。
- 不要代使用者輸入密碼或驗證碼。
