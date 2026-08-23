# 到站 V2.1

Mobile-first 香港巴士實時 ETA PWA。保留原 V2 無 framework 架構，可直接放到 GitHub Pages。

## 已完成

- 九巴／龍運及城巴路線搜尋、雙向站序、每站最多三班 ETA
- 收藏「營辦商＋路線＋方向＋上車站」，首頁直接更新三班 ETA
- 只搜尋 100m 內九巴／城巴站，合併、去重及按到站時間排序；先顯示 8 班
- 運輸署 Special Traffic News：事故、位置、方向、發布／更新、持續時間、狀態及摘要
- Warning 與常搭文字位置有明顯重疊時，只標示「可能受影響」
- API 各自容錯、定位拒絕 fallback、iPhone safe-area／44px touch targets
- PWA manifest、service worker 更新策略、GitHub Pages workflow
- 點到點資料／UI 架構預留（200–300m，與 100m 功能分開）

城巴官方 API 沒有全站一次下載 endpoint；部署包內 `ctb-stops.json` 由 HK Bus Crawling 每日整合資料生成（原始資料仍來自營辦商／政府開放數據）。可執行 `node scripts/generate-ctb-stops.mjs` 更新。資料整合來源：[HK Bus Crawling](https://github.com/hkbus/hk-bus-crawling)。

九巴／龍運站點索引直接由官方 stop list 生成；可執行 `node scripts/generate-kmb-stops.mjs` 更新。兩份索引只包含站名及座標，ETA 仍為即時請求。

## 本機執行

```bash
python -m http.server 8000
```

開啟 `http://localhost:8000`。手機定位在正式環境需要 HTTPS（localhost 除外）。

## GitHub Pages

將資料夾內容 push 到 `main`，在 repository Settings → Pages 將 Source 設為 GitHub Actions；`.github/workflows/pages.yml` 會部署整個靜態 app。

## Traffic Warning proxy（可選）

運輸署 endpoint 現時有 CORS，但 app 亦會在直連失敗時嘗試 `./api/traffic`。`proxy/cloudflare-worker.js` 是免費 Cloudflare Workers 範例。部署後可將 `app.js` 內 `TRAFFIC_PROXY` 改成 Worker 的完整 `/api/traffic` URL。Warning API 失敗只會隱藏提示，不會影響 ETA。

## 限制

- 運輸署 XML 只提供每則消息目前的 `ANNOUNCEMENT_DATE`。App 會按事故編號在本機保存最早見過的時間；若首次開 App 時消息已是 UPDATED，無法追溯官方最初發布時間，畫面會以最早可取得的官方時間顯示。
- 「可能受影響」只在事故道路名稱與收藏的起點／終點／站名有清楚文字重疊時顯示，未建立完整路線道路 GIS 關聯，絕不宣稱一定延誤。
- 點到點 routing engine、小巴及港鐵 live data 尚未接入；目前只保留模式與距離設定架構。
- ETA、站點及交通消息均取決於資料供應者，可能暫停、延遲或沒有預報。

資料來源：運輸署、九巴／龍運及城巴開放數據。到站為非官方應用，並非任何營辦商官方產品。
