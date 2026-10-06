# INSARAG A5 隨身圖解手冊

供演習人員攜帶閱讀。採用 2027 版規則（2027-01-01 生效），並以淺藍底、左側藍色條與藍色「2027」標籤標示相對 2020 版的異動；2026 年底前的演習仍適用 2020 版，2020 版手冊保留在 git 歷史（commit `c8362d1`）。黃色底與警告三角形「注意」區塊為演習提醒，不是原指引規定。語言為臺灣正體中文，共 12 頁；每頁為 A5（148 × 210 mm）。圖文依官方原件重繪，圖片與 PDF 圖形皆為向量。

| 用途 | 檔案 |
| --- | --- |
| 閱讀、列印 | [A5 PDF](insarag-marking-a5-zh-tw.pdf) |
| 瀏覽全部頁面 | [HTML 預覽](preview.html) |
| 編輯內容 | [文字來源](manual.json)、[閱讀用 Markdown](manual.md) |
| 編輯圖形 | [12 頁 SVG](pages/01.svg)、[圖形資料](scenes.json)、[產生 script](scripts/build_handbook.py) |
| Figma 編輯與匯出 | [12 頁 A5 手冊](https://www.figma.com/design/NJHNxTRl5zdtYkATo6ig9N/INSARAG?node-id=7-37)、[同步與驗收紀錄](figma/README.md) |
| 核對名詞 | [中英對照表](terminology.md)、[機器可讀 CSV](terminology.csv) |
| 核對寫作方法 | [STE 原則應用與檢查範圍](ste-method.md) |
| 回查原件 | [手冊頁碼與來源對照](sources.md)、[完整來源索引](../sources/README.md) |
| 驗收 | [驗收紀錄](verification.md)、[檢查結果](check-report.json)、[產出雜湊](build-manifest.json) |

## 列印

以 A5、實際大小列印。雙面列印時，選擇長邊翻頁。若使用 A4 紙裝訂成小冊，啟用 PDF 閱讀器的「小冊子」功能。依印表機設定翻頁方式。先試印一張核對頁序。本 PDF 保留正常閱讀頁序，沒有預先拼版。圖中公分數是現場標記參考，印出的圖例不是實際施工比例。

## 印刷輸出

交付印刷廠時，產生 300 dpi 的 RGB 與 CMYK PDF。輸出檔放在 `print/`，不列入 git；每次重新產生手冊後，重新輸出。

```powershell
python docs/insarag/handbook/scripts/export_print_pdf.py
```

需要 PyMuPDF 與 Pillow。每頁以 300 dpi 點陣化，使用無失真壓縮。CMYK 由 sRGB 經 ICC 描述檔轉換，預設使用 Windows 內建的 `RSWOP.icm`（SWOP），並把該描述檔嵌入 PDF。若印刷廠指定其他描述檔，用 `--cmyk-profile` 指定。`print/print-report.json` 記錄頁數、解析度、嵌入描述檔與最大總墨量。

## 獨立檢查

本機 Windows 可直接執行 PowerShell 入口；它會尋找 Python 與 `zhtw-mcp`：

```powershell
& './docs/insarag/handbook/scripts/check-handbook.ps1'
```

檢查 script 只需 Python 3.10 以上，使用標準函式庫。本機 `zhtw-mcp` 須已安裝並可從 PATH 啟動；可用參數指定執行檔。從儲存庫根目錄執行：

```powershell
python docs/insarag/handbook/scripts/check_handbook.py --report docs/insarag/handbook/check-report.json
```

若執行檔不在 PATH：

```powershell
python docs/insarag/handbook/scripts/check_handbook.py --zhtw-command 'C:\path\to\zhtw-mcp.exe' --report docs/insarag/handbook/check-report.json
```

只執行本機對照表、結構與雜湊檢查，以及檢查器的自我測試：

```powershell
python docs/insarag/handbook/scripts/check_handbook.py --offline
python docs/insarag/handbook/scripts/check_handbook.py --selftest
```

`--offline` 報告會明確記錄未呼叫 MCP，不可視為完整的臺灣用語檢查。完整檢查經由 MCP stdio 協定呼叫本機 `zhtw` 工具，不需要 Codex 對話環境；設定 `verify=false`，不呼叫 Google Translate 校準。檢查不自動改寫手冊。結束代碼：`0` 符合全部門檻；`1` 有錯誤、警告、MCP 不符合門檻或產出過期；`2` 執行環境或檔案格式錯誤。

手冊文字與圖中文字共同檢查。README、STE 方法、來源對照、驗收紀錄與 Figma 同步說明另行檢查；略過指令區塊，保留檔名等原始字串，表格各欄分開檢查。兩份 MCP 結果與輸入雜湊均寫入報告。

## 修改與重新產生

1. 修改 `manual.json` 的文字。
2. 若修改名詞，先核對原件，再更新 `terminology.csv`。
3. 若修改圖示，修改 `scripts/build_handbook.py` 的向量圖形。
4. 重新產生全部檔案。
5. 執行完整檢查。
6. 逐頁檢視 PDF 與 SVG。

```powershell
python docs/insarag/handbook/scripts/build_handbook.py
python docs/insarag/handbook/scripts/check_handbook.py --report docs/insarag/handbook/check-report.json
```

產生 script 需要 `reportlab`。預設讀取 Windows 的 Microsoft JhengHei 正常體與粗體；可用 `--font-dir` 指向含 `msjh.ttc`、`msjhbd.ttc` 的資料夾。PDF 嵌入字型；SVG 以文字與圖形保留可編輯性，檢視裝置需有對應中文字型。不要直接修改產出的 PDF、SVG、Markdown 或 `scenes.json`；這些檔案會於重新產生時覆寫。

專有名詞、單句動作及中文短句檢查是本專案規則。中文不能直接套用英文 STE 的字數門檻；符合檢查門檻不等於 ASD-STE100 認證，也不取代 INSARAG 技術內容驗收。
