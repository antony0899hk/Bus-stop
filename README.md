# 到站 V3.0

Mobile-first 香港公共交通實時 ETA PWA，沿用原有無 framework、GitHub Pages 架構。

## 已完成

- 九巴／龍運、城巴及綠色專線小巴路線搜尋、方向、站序及每站最多三班 ETA
- 統一資料欄位：`operator`、`route`、`direction/bound`、`stopId`、`stopName`、`destination`、`eta`、`lat`、`lng/long`
- 收藏「營辦商＋路線＋方向＋常用站」，Safari／PWA 重開後仍保留並在首頁更新 ETA
- 100m 內混合九巴、城巴、小巴 ETA，去重及按到站時間排序
- 全部／九巴／城巴／小巴／MTR Filter；MTR 只預留架構，不顯示假 ETA
- 100m 清單預設 8 班；「顯示更多 ↓／收起 ↑」雙向 toggle，展開時頂部亦有 sticky 收起按鈕
- 運輸署 Special Traffic News、首次見到時間、最新更新、持續時間、狀態及可能受影響常搭
- API 獨立容錯、20 秒 ETA cache、有限 concurrency、定位拒絕 fallback、iPhone safe-area 及 44px touch targets
- PWA service worker cache `daozhan-v3.0.0`

## 官方資料來源

- 九巴／龍運：`https://data.etabus.gov.hk/v1/transport/kmb`
- 城巴：`https://rt.data.gov.hk/v2/transport/citybus`
- 綠色專線小巴：`https://data.etagmb.gov.hk`
- 交通消息：運輸署 Special Traffic News XML

小巴完整站點索引由 `scripts/generate-gmb-data.mjs` 使用官方 route、route-stop、stop API 產生，並分成小檔案以提升 iPhone 載入可靠度；實時 ETA 仍由瀏覽器直接向官方 API 查詢。工作流程亦會逢星期一更新索引。

## 本機執行

先產生小巴資料，再啟動靜態伺服器：

```bash
node scripts/generate-gmb-data.mjs
python -m http.server 8000
```

## 限制

- MTR 目前只保留 filter、`operator = MTR` 及點到點 adapter 位置，未展示 Next Train 假資料。
- 點到點 routing engine 尚未完成；100m 即將到站與預留的 200–300m 點到點搜尋互相獨立。
- 運輸署 XML 若受 CORS 阻擋會嘗試 `./api/traffic` fallback；兩者均失敗只會隱藏 Warning，不影響 ETA。
- ETA 視乎官方資料供應，個別班次沒有資料時顯示「未有預報」。

資料來源：香港運輸署、九巴／龍運及城巴開放數據。到站為非官方應用，資料只供參考。
