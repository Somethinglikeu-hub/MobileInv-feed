# MobileInv PWA

MobileInv'in ana kullanıcı uygulamasıdır. Android APK artık birincil istemci değildir; ürünün kanonik arayüzü bu repodaki kurulabilir PWA/WebUI'dır.

- Uygulama: https://somethinglikeu-hub.github.io/MobileInv-feed/
- Yayın branch'i: `gh-pages`
- Veri kaynağı: `manifest.json` ve `mobile_snapshot.db.gz`
- Çalışma biçimi: Tarayıcıdan açılır, Android/iOS ana ekranına kurulabilir ve son indirilen snapshot ile çevrimdışı çalışabilir.

## Geliştirme kuralları

1. Kullanıcı arayüzü değişiklikleri öncelikle bu PWA üzerinde yapılır.
2. History ve performans değerleri yalnızca merkezi snapshot verilerinden hesaplanır; `localStorage` veya sabit seed performans verisi kullanılmaz.
3. `manifest.json` ve `mobile_snapshot.db.gz`, Python backend'deki snapshot export koduyla üretilir.
4. Kurulu uygulamanın yeni kodu alabilmesi için asset sürümü ve service-worker cache sürümü gerektiğinde artırılır.
5. Android native uygulama ancak ayrıca istenirse güncellenir.
6. Pako, SQL.js/WASM ve ApexCharts runtime dosyaları `vendor/` altında sabitlenir; ana uygulama açılışı CDN erişimine bağlı bırakılmaz.

## Kalite kontrolleri

Her push'ta `.github/workflows/pwa-quality.yml` aşağıdaki kontrolleri çalıştırır:

- `app.js` ve `sw.js` JavaScript sözdizimi
- Gerekli PWA/runtime varlıklarının repoda bulunması
- `manifest.json` içindeki snapshot boyutu ve SHA-256 değerinin gerçek dosyayla eşleşmesi
- Service worker ve asset sürümlerinin beklenen sürümde olması

## 23 Haziran 2026 düzeltmeleri

History, backtest, snapshot üretimi, kurulu PWA güncellemesi, offline açılış, doğru ikonlar, yavaş mobil bağlantı başlangıcı, snapshot bütünlük kontrolü, bozuk cache kurtarma ve yerel runtime bağımlılıkları düzeltildi.

Ayrıntılı teknik kayıt ana backend reposundaki `docs/PWA_MAIN_APP_AND_HISTORY_FIX_2026-06-23.md` dosyasındadır.
