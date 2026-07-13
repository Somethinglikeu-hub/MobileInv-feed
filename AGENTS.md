# MobileInv-feed — Agent Entry Point

Bu repo MobileInv'in tek aktif kullanıcı arayüzü olan PWA/WebUI'dir.

## Önce oku

Backend sibling checkout varsa:

1. `../MobileInv/AGENTS.md`
2. `../MobileInv/docs/CURRENT_STATE.md`
3. `../MobileInv/docs/ARCHITECTURE.md`
4. Model/performance işi için `../MobileInv/docs/MODEL_AND_BACKTEST.md`
5. Yayın/arıza işi için `../MobileInv/docs/OPERATIONS.md`

Eski dated handoff/progress belgelerini güncel talimat olarak kullanma.

## Repo sözleşmesi

- Yayın branch'i `gh-pages`; public URL:
  `https://somethinglikeu-hub.github.io/MobileInv-feed/`.
- `manifest.json` pointer/özet; ayrıntı `mobile_snapshot.db.gz` içindedir.
- `live-data` branch'indeki `live_prices.json` snapshot'tan bağımsız canlıya
  yakın fiyat kaynağıdır.
- `snapshot_date`, `exported_at`, `latest_price_date` ve quote zamanı ayrıdır.
- `manifest.json` ve snapshot backend tarafından üretilir; UI işi sırasında
  elle finansal veri/performans seed etme.
- Asset veya service-worker sürümü değişirse `index.html`, `sw.js` ve
  `tests/pwa-static-check.mjs` birlikte güncellenir.
- `vendor/` runtime dosyaları CDN bağımlılığını kaldırır; lisans/sürüm birlikte
  korunur.
- `app.js` ve `index.css` büyük ama aktiftir. Sırf satır sayısı için bölme veya
  silme yapma; refactor ayrı PR, statik + etkileşimli regresyon testi ister.
- Android aktif geliştirme hedefi değildir.

## Zorunlu kontroller

```powershell
node --check app.js
node --check sw.js
node tests/pwa-static-check.mjs
git diff --check
```

Görsel/etkileşim değişikliğinde ayrıca canlı veya yerel PWA'da portföy,
Keşfet araması, sheet aç/kapat, History ve service-worker güncellemesi kontrol
edilir.
