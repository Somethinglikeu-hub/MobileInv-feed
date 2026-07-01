# MobileInv PWA

MobileInv'in tek aktif kullanıcı uygulamasıdır. Android APK artık geliştirilmez; ürünün kanonik arayüzü bu repodaki kurulabilir PWA/WebUI'dır.

- Uygulama: https://somethinglikeu-hub.github.io/MobileInv-feed/
- Yayın branch'i: `gh-pages`
- Veri kaynağı: `manifest.json` ve `mobile_snapshot.db.gz`
- Canlıya yakın fiyat kaynağı: `live-data` branch'indeki `live_prices.json`
- Çalışma biçimi: Tarayıcıdan açılır, Android/iOS ana ekranına kurulabilir ve son indirilen snapshot ile çevrimdışı çalışabilir.
- Ürün kapsamı: `MobileInv-mobile-v2` arşiv/legacy olarak durur; UI, History, Backtesting, canlı fiyat ve bildirim işleri bu PWA üzerinde yapılır.

## Kullanım akışı

PWA yatırım kararını tek ekranda toplamak için tasarlanır:

1. `Picks` ekranında Main V2'nin aktif 5 hisse portföyü kontrol edilir.
2. Aynı ekrandaki karar özeti; nakit rejimini, 4 yıllık T+1 backtest sonucunu, en sert slippage stresini ve audit uyarısını birlikte gösterir.
3. `Zeki Sinyaller` bölümündeki `AL`, `SAT`, `TUT` kararları haftalık rebalans disiplinidir; tek günlük fiyat hareketleriyle model dışına çıkılmamalıdır.
4. `Market` ekranındaki nakit rejimi NORMAL, CAUTION, DEFENSIVE veya RISK_OFF durumuna göre hisse/nakit ağırlığı belirler.
5. `History > Backtesting` paneli her hafta güven kontrolü olarak okunur. T+1 execution, slippage, drawdown, fiyat-jump veya survivorship uyarısı bozulursa pozisyon büyütülmez.
6. Program karar destek aracıdır. Pozisyon büyüklüğü, maksimum zarar toleransı ve nakit tamponu kullanıcı tarafından önceden belirlenmelidir.

## Geliştirme kuralları

1. Kullanıcı arayüzü değişiklikleri öncelikle bu PWA üzerinde yapılır.
2. History ve performans değerleri yalnızca merkezi snapshot verilerinden hesaplanır; `localStorage` veya sabit seed performans verisi kullanılmaz.
3. `manifest.json` ve `mobile_snapshot.db.gz`, Python backend'deki snapshot export koduyla üretilir.
4. Canlıya yakın fiyatlar PWA içinde tarayıcıdan Yahoo'ya doğrudan giderek değil, backend workflow'unun yayınladığı `live_prices.json` üzerinden okunur.
5. Fiyat feed'i gelmezse uygulama snapshot fiyatıyla çalışır ve UI bunu `SNAPSHOT` olarak etiketler.
6. Kurulu uygulamanın yeni kodu alabilmesi için asset sürümü ve service-worker cache sürümü gerektiğinde artırılır.
7. Android native uygulama aktif geliştirme dışıdır; dosyalar korunur ama Android'e yeni özellik, bug fix, UI, performans veya bildirim işi açılmaz.
8. Pako, SQL.js/WASM ve ApexCharts runtime dosyaları `vendor/` altında sabitlenir; ana uygulama açılışı CDN erişimine bağlı bırakılmaz.

## Kalite kontrolleri

Her push'ta `.github/workflows/pwa-quality.yml` aşağıdaki kontrolleri çalıştırır:

- `app.js` ve `sw.js` JavaScript sözdizimi
- Gerekli PWA/runtime varlıklarının repoda bulunması
- `manifest.json` içindeki snapshot boyutu ve SHA-256 değerinin gerçek dosyayla eşleşmesi
- Service worker ve asset sürümlerinin beklenen sürümde olması

## 23 Haziran 2026 düzeltmeleri

History, backtest, snapshot üretimi, kurulu PWA güncellemesi, offline açılış, doğru ikonlar, yavaş mobil bağlantı başlangıcı, snapshot bütünlük kontrolü, bozuk cache kurtarma ve yerel runtime bağımlılıkları düzeltildi.

Canlı fiyat tarafında `v8` ile PWA artık snapshot kapanış fiyatını `CANLI` diye göstermiyor. Backend'in 15 dakikalık workflow'u `live-data/live_prices.json` üretir; PWA bunu kullanır, başarısız olursa açık biçimde snapshot fallback'e döner.

## 25 Haziran 2026 PWA geliştirmeleri

- `Picks` ekranına Main V2 karar özeti eklendi: portföy doluluğu, nakit rejimi, 4 yıllık T+1 model getirisi, stres testi ve fiyat kaynağı aynı kartta gösterilir.
- `Hakkında` ekranına programla nasıl yatırım yapılacağını anlatan haftalık kullanım rehberi eklendi.
- Investor-grade güven kontrolü Hakkında ekranında kısa özet olarak görünür hale getirildi.
- Asset ve service-worker cache sürümü `v9` yapıldı.

Ayrıntılı teknik kayıt ana backend reposundaki `docs/PWA_MAIN_APP_AND_HISTORY_FIX_2026-06-23.md` dosyasındadır.
