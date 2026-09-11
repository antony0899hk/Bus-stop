# 到站 Architecture Freeze

## Core rule

除港鐵鐵路的輕量 network topology 外，不在瀏覽器常駐全港重型交通資料。

所有地面交通搜尋遵守同一流程：

1. 起點／目前位置：100m → 200m → 400m。
2. 終點：100m → 200m → 400m。
3. 只載入命中範圍內的站、路線及 ETA。
4. 點對點只沿真正有用的 route / corridor / gateway 漸進展開。
5. 不使用「先載全港資料，再 filter」作為功能捷徑。

## Runtime data policy

- KMB / CTB：現有基礎資料逐步改為 local / indexed access；新功能不得新增全港掃描。
- GMB：Spatial tiles；Nearby 只下載目前位置相鄰 tiles，route metadata 只在搜尋或點對點需要時載入 lightweight index。
- MTR Bus：三個獨立 bundle：`tai-po`、`yuen-long-tin-shui-wai`、`tuen-mun`。Nearby 只開所在服務區 bundle。
- NLB：按 route / location on-demand；不得自動展開全 catalogue stops。
- MTR Rail：唯一可保留全網輕量 topology 的模式。Fare / station detail 按需載入。

## MTR journey model

MTR 不以 Next Train ETA 作為點對點必要條件。主 Engine 只需要：

- A 站 → B 站的 railway path
- 轉線位置
- 固定／官方預計 journey time
- fare
- 起點及終點接駁的巴士／小巴 Live ETA

即：`接駁 + MTR 固定時間 + 接駁`，再與純巴士方案比較。

## Change policy

目前進入收斂期：只做流程整理、資料簡化、效能優化、準確度改善及 bug fix。除非核心假設被實際測試證明錯誤，否則不再另開一套 routing architecture，也不以新增 wrapper 疊加舊邏輯作長期方案。
