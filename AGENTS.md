# Agent Handoff

Bu repo MobileInv'in tek aktif kullanıcı arayüzü olan PWA/WebUI'yi barındırır.

## Önce Oku

Ana backend reposundaki güncel handoff:

`MobileInv/docs/HANDOFF_2026-07-02_FABLE5.md`

Bu feed repo için yerel özet:

- Aktif branch: `gh-pages`
- Public uygulama: https://somethinglikeu-hub.github.io/MobileInv-feed/
- Veri dosyaları: `manifest.json` ve `mobile_snapshot.db.gz`
- Canlıya yakın fiyat feed'i: `live-data` branch'indeki `live_prices.json`
- Android artık aktif geliştirme hedefi değildir; UI ve ürün işleri PWA'da yapılır.

## Dikkat Edilecekler

- `manifest.json` küçük bir pointer dosyasıdır; detaylı tarih/pozisyon/performance verileri gzipped SQLite snapshot içindedir.
- `snapshot_date` feed'in üretildiği model snapshot tarihidir.
- `latest_price_date` borsadaki son kapanış fiyat tarihidir. Sabah run'larında bugünün tarihi yerine önceki işlem günü görünmesi normal olabilir.
- Asset veya service worker sürümü değişirse `tests/pwa-static-check.mjs` beklentilerini de güncelle.
- Commit/push öncesi şu kontrolleri çalıştır:
  `node --check app.js`
  `node --check sw.js`
  `node tests/pwa-static-check.mjs`
