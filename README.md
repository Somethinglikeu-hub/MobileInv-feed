# MobileInv PWA

MobileInv'in kurulabilir, offline-first ve tek aktif kullanıcı uygulaması.

- Canlı: [BIST Picker PWA](https://somethinglikeu-hub.github.io/MobileInv-feed/)
- Yayın branch'i: `gh-pages`
- Canlıya yakın fiyat branch'i: `live-data`
- Güncel shell/cache sözleşmesi: `v18`

Android repo arşivdir; yeni UI, History, Backtesting, fiyat ve karar görünürlüğü
işleri bu PWA'da yapılır.

## Veri akışı

```text
MobileInv backend
  ├─ manifest.json + mobile_snapshot.db.gz ─► gh-pages
  └─ live_prices.json ──────────────────────► live-data
                                                │
                                                ▼
                                           PWA/WebUI
```

- `manifest.json` küçük pointer ve doğrulama özetidir.
- Şirketler, skorlar, pozisyonlar, history ve performans gzip SQLite snapshot
  içindedir.
- Live feed yoksa PWA son işlem/snapshot fiyatına düşer ve kaynağı etiketler.
- Quote zamanı, model tarihi ve son kapanış tarihi birbirinin yerine kullanılmaz.
- History/performance yalnız backend snapshot sözleşmesinden okunur; sabit veya
  `localStorage` performans verisi üretilmez.

Model, backtest ve bilinen risklerin kanonik açıklaması backend reposundaki
`docs/CURRENT_STATE.md` ve `docs/MODEL_AND_BACKTEST.md` dosyalarındadır.

## Ana dosyalar

| Dosya | Rol |
|---|---|
| `index.html` | PWA shell ve erişilebilir DOM iskeleti |
| `app.js` | SQLite yükleme, read model, sayfalar ve etkileşimler |
| `index.css` | Mobil tasarım ve responsive davranış |
| `sw.js` | Offline cache ve asset güncelleme |
| `manifest.webmanifest` | Kurulum metadata'sı |
| `vendor/` | Sabitlenmiş Pako, SQL.js/WASM ve ApexCharts |
| `tests/pwa-static-check.mjs` | Asset, cache, snapshot hash ve kritik UI sözleşmeleri |

## Geliştirme ve kalite

```bash
node --check app.js
node --check sw.js
node tests/pwa-static-check.mjs
```

Her push'ta `.github/workflows/pwa-quality.yml` aynı çekirdek kontrolleri
çalıştırır. UI davranışı değiştiyse ayrıca tarayıcıda:

1. Portföy ve veri-sağlığı kartı,
2. Keşfet arama/filtre,
3. hisse ve backtest sheet'leri,
4. Piyasa/Geçmiş/Hakkında sekmeleri,
5. offline/service-worker güncellemesi

kontrol edilir.

## Yayın güvenliği

- Snapshot SHA-256 manifest ile eşleşmelidir.
- Eski snapshot yeni feed'i bilinçsizce ezemez.
- Asset/cache versiyonları birlikte artırılır.
- Generated manifest/snapshot UI PR'ına elle eklenmez; backend publish run'ı
  üretir.
- Yanlış yayın force-push ile değil revert commit/PR ve yeni Pages deploy ile
  geri alınır.
