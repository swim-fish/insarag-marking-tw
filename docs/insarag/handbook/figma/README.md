# Figma 手冊同步與驗收

[開啟 12 頁手冊](https://www.figma.com/design/NJHNxTRl5zdtYkATo6ig9N/INSARAG?node-id=7-37)。首次同步與改版同步日：2026-10-05。目標頁面為 `0:1`，手冊區段為 `7:37`；頁序由左至右、由上至下，共 12 頁。

每頁為 A5（148 × 210 mm），頁框尺寸為 419.52756 × 595.27559 Figma 單位。已逐頁核對 Figma 原生 PDF 匯出的 MediaBox，確認實際尺寸為 A5。匯出時使用 PDF 或 SVG；列印時選擇「實際大小」。圖例中的公分數為現場標記參考，手冊圖示不是施工比例。

圖示保留為向量路徑；文字保留為可編輯的文字圖層。Figma 使用 Noto Sans TC 正常體與粗體，既有本機 PDF 使用 Microsoft JhengHei，因此兩版字型外觀略有不同。12 頁 PDF 的點陣圖片物件數均為 0，SVG 每頁均有 0 個 image 元素。共用頁首採用元件；頁面不設來源欄位，來源見 [逐頁來源](../sources.md)。色彩及字級使用本檔案的共用變數與樣式。

**改版同步：** 第 1、2、3、5、6、9、10 頁的圖示、日期格式與版面修正，各頁補充說明精簡，以及移除頁尾來源欄位，已以 `update-*.js` 原地重建 12 個頁框（頁框識別碼不變），並移除不再使用的來源欄位元件。改版後驗收結果見 [sync-report.json](sync-report.json)。

**2027 版：** 第 1、2、3、6、9、10、11、12 頁已依 2027 版指引原地重建，異動以淺藍底、藍色條與「2027」標籤標示；12 頁驗收全部合格。

第 2 頁的隊伍編號、ASR 等級與日期為同一個文字圖層，維持官方圖例的同列配置。全部文字逐項核對 [手冊文字來源](../manual.json) 與 [圖形資料](../scenes.json)，沒有缺漏或多出的文字；名詞檢查依 [中英對照表](../terminology.csv)。原件、章節與圖表位置見 [逐頁來源](../sources.md)。

## 可重跑的證據

- [sync-report.json](sync-report.json)：12 頁的頁框尺寸、PDF MediaBox、文字比對、字型、邊界及向量檢查。
- [source-manifest.json](source-manifest.json)：文字、圖形及名詞來源的 SHA-256。
- [state.json](state.json)：頁框、共用元件、變數及樣式的識別碼。
- `compose-report-*.json`：分批建立的圖層識別碼與檢查結果。
- [prepare_sync.py](prepare_sync.py)：從已驗證的來源準備 Figma 同步 script。
- [prepare_validation.py](prepare_validation.py)：從來源文字與已存頁框識別碼準備唯讀驗收 script。

從儲存庫根目錄執行：

```powershell
python docs/insarag/handbook/figma/prepare_sync.py
python docs/insarag/handbook/figma/prepare_validation.py
```

產出的 JavaScript 需經 Figma `use_figma` 工具執行。準備 script 不會自行修改雲端檔案。`setup.js` 及 `compose-*.js` 為首次建立用途；已有頁面時會停止，避免重複建立。`update-*.js` 用於改版：依已存頁框識別碼清除並重建頁面內容，執行前先以唯讀方式核對既有圖層。`validate.js` 為唯讀檢查。來源變更後，應重新執行本機語言檢查及 Figma 驗收，並更新兩份報告。

本機手冊來源是編輯基準。Figma 編輯不會自動回寫本機來源。已檢視完整 12 頁畫面，未執行實體印表機試印。
