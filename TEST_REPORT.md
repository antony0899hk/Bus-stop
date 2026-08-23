# 到站 V3.0 測試報告

## 已完成的靜態／自動檢查

- `node --check app.js`
- `node --check scripts/generate-gmb-data.mjs`
- HTML 元件 ID 與 JavaScript event handler 對應
- Filter：全部、KMB、CTB、GMB、MTR
- nearby toggle：預設 8、展開最多 40、頂部及底部收起
- service worker cache：`daozhan-v3.0.0`
- 320px、360px、420px mobile CSS breakpoint 及 horizontal overflow 防護
- 個別營辦商 request 以 try/catch 隔離；ETA cache 20 秒；route/stop cache 5 分鐘；附近 request concurrency 4

## 指定路線測試矩陣

部署後於真實官方 API／定位環境測試：

- 九巴：270A、68X
- 978：目前官方路線資料列作九巴／龍運（不是城巴）；另以城巴 979 驗證城巴 adapter
- 綠色專線小巴：55K，另由部署時官方 route list 選取最少兩條當時有 ETA 的路線
- 搜尋、方向、站序、三班 ETA、收藏、reload 持久化、100m nearby、Filter、顯示更多、收起

## 說明

本地靜態環境沒有 `data.etagmb.gov.hk` 網絡存取權，完整小巴索引會由 GitHub Actions 在 Pages 部署時用官方 API 產生。因此真實 ETA、定位及 Safari PWA 實機測試必須在部署完成後執行。
