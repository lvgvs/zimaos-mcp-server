# Araç kullanımı ve güvenlik semantiği

[English](TOOL-USAGE.md) · [Herkese açık araç listesi](../README.tr.md#araç-referansı)

Ayrıntılı sözleşmeler README’deki kısa listeyi tamamlar; ek izin vermez.

## Sistem tanılama

Sistem tanılama, yalnızca `{}` kabul eden iki kimlik doğrulamalı salt okunur araç sunar; ek alanlar
reddedilir. Tüm değişiklik izinleri kapalı kalabilir. ZimaOS yenileme/kontrol işlemi, abonelik
değişikliği, durum sıfırlama, kurulum, yeniden başlatma veya uygulama güncellemesi yapılmaz.
Bu araçlar v0.4.0 ve sonraki sürümlerde mevcuttur.

- `get_system_resources`, mevcutsa `cpu.utilizationPercent` (0–100) ve
  `cpu.logicalProcessors` (1–4096); `memory.totalBytes`, `usedBytes`, `availableBytes`,
  `freeBytes`, `usedPercent` (0–100); `systemStorage.totalBytes`, `usedBytes`,
  `availableBytes` döndürür. Bayt sayaçları negatif olmayan güvenli tamsayılardır. Eksik alanlar
  ve boş gruplar atlanır, sıfırla doldurulmaz. Geçersiz sayısal kanıt fail-closed davranır.
  Değerler upstream örnekleridir; anlık ölçüm veya ortak zamanlı snapshot garantisi değildir.
  Yuvarlanmış yüzdeler bayt oranlarıyla tam eşleşmeyebilir. Kullanılabilir bellek boş bellek
  değildir; dosya sisteminde kullanılabilir alan, toplam eksi kullanılan alana eşit olmak
  zorunda değildir. Depolama yalnızca sistem dosya sistemini kapsar, tüm disk/havuzları değil.
  Sıfır sensör yokluğu anlamına gelebildiğinden sıcaklık atlanır; upstream depolama sağlık
  anlamı makine/havuz sağlık kararı için yeterli değildir. Ağ, GPU, güç, yol veya disk kimliği
  verisi döndürülmez.
- `get_os_update_status`, `currentVersion`, `latestVersion`, `notice`, `updateAvailable`,
  `installerStatus` ve `betaSubscription` döndürür. `notice`, `no-update`, `normal-update`,
  `important-update` veya `force-update` olur; `updateAvailable` yalnızca `no-update` için false'tur.
  Bu, Installer'ın bildirdiği sınıflandırmadır; sürüm karşılaştırması veya kurulum uygunluğu
  garantisi **değildir**. `installerStatus`, `idle`, `installing` veya `installError` olur;
  idle tamamlanmayı kanıtlamaz. `betaSubscription`, `enabled` veya `disabled` olur, kanal
  uygunluğu kararı değildir. Ardışık beş okuma atomik değildir; aralarında durum değişebilir.
  Sürümler, isteğe bağlı ön sürüm son ekiyle noktayla ayrılmış üç bileşenli biçimde en fazla
  64 ASCII karakterdir; hatalı, tanınmayan veya kimlik bilgisi taşıyan kanıt fail-closed davranır.
  Sürüm notları, ham mesajlar ve arayüzün yaklaşık adım bazlı ilerlemesi döndürülmez.
- Her tanılama yanıtı 64 KiB ile sınırlıdır; zaman aşımı tüm gövdeyi kapsar ve yönlendirmeler
  reddedilir. Upstream hataları, yanlış no-update/sağlıklı sonucu değil normalize edilmiş hata döndürür.

## App Store keşfi

App Store keşfi v0.3.0 ve sonraki sürümlerde mevcuttur. İki araç da normal MCP
kimlik doğrulaması gerektirir, tüm değişiklik izinleri kapalıyken çalışır ve yalnızca desteklenen
ZimaOS okumalarını (gerektiğinde kimlik doğrulamasıyla birlikte) yapar. Depoları yönetmez ve
istemcinin verdiği URL'lerden veri indirmez.

- `search_app_store`, yalnızca `{ "query": "arama metni", "limit": 20 }` kabul eder.
  `query` zorunlu, başı/sonu kırpılan, boş olmayan düz metindir: kırpmadan önce en fazla
  256 UTF-16 kod birimi olabilir; kontrol karakterleri ve DEL reddedilir. `limit` isteğe
  bağlıdır; 1–50 arasında tamsayıdır, varsayılanı 20'dir. Doğrulanan upstream API boş
  sorguyla gezinmeyi desteklemez.
- Arama `{ "apps": [...], "truncated": false }` döndürür. Her uygulama tam `repo_id` ve
  `app_id` ile mevcutsa `name`, `version`, `tagline`, `category`, `architectures` alanlarını
  içerir. ZimaOS'un bulanık aramasını sabit İngilizce yerelleştirmeyle kullanır, her biri
  60 girdilik en fazla beş sayfa okur ve limiti uygulamadan önce bu sınırlı alaka penceresini
  depo/uygulama kimliğine göre sıralar. `truncated`, limit veya pencere nedeniyle sonuçların
  dışarıda kaldığını belirtir; katalog genelinde sıralama veya eksiksizlik garantisi değildir.
  Farklı depolardaki aynı uygulama kimliği ayrı kalır; yinelenen tam çiftler, başarısız depolar
  veya tutarsız sayfalar fail-closed davranır.
- `get_app_store_details`, yalnızca `{ "repo_id": "registered-repo-id",
"app_id": "com.example.app" }` kabul eder; aynı kimlik/özet alanlarıyla birlikte mevcutsa
  `description`, `author`, `developer`, `release_notes` döndürür. İki araç da bulunmayan
  isteğe bağlı alanları atlar. Ayrıntılar ham Compose, yapılandırma, kaynak URL'leri, kurulu
  olma durumu, güncelleme uygunluğu veya uyumluluk kararı içermez. Bildirilen mimariler
  kurulum uygunluğu garantisi değildir; mevcut kurulum aracı güvenlik sözleşmesini bağımsız
  olarak yeniden doğrular.
- Görüntüleme metinleri UTF-16 kod birimiyle sınırlıdır: ad 120, sürüm 80, kısa açıklama
  512, kategori 128, açıklama 12.000, yazar/geliştirici ayrı ayrı 256, sürüm notları 8.000.
  Mimariler en fazla sekiz benzersiz, sıralı, küçük harfli alfanümerik/alt çizgi etiketidir;
  her biri en fazla 32 karakterdir. Hatalı veya kimlik bilgisi taşıyan seçili metadata
  sessizce kırpılmaz veya kısmen döndürülmez; fail-closed davranır. Katalog açıklamaları
  güvenilmeyen içeriktir, talimat değildir.

## Yerel App Store kurulumu

`install_app_from_store`, yalnızca iki zorunlu string alan kabul eder:

```json
{ "repo_id": "registered-repo-id", "app_id": "com.example.app" }
```

Host'un kayıtlı App Store deposu/kataloğundaki tam kimlikleri kullanın; görünen adları veya
URL'leri değil. Depo kimlikleri 128, kanonik küçük harfli ters alan adı biçimindeki uygulama
kimlikleri 192 karakterle sınırlıdır. Ek alanlar reddedilir. İstemci tarafından verilen Compose,
depo/Compose URL'si, mimari override, sürüm, force, update veya downgrade seçeneği yoktur.
v0.3.0 ve sonraki sürümlerde tam kimlikleri `search_app_store` ve `get_app_store_details` ile alın;
keşif içermeyen önceki sürümlerde normal App Store arayüzünü/kataloğunu kullanın.
[`v0.3.0 sürüm notlarına`](RELEASE-NOTES-v0.3.0.md) bakın.
Depo yönetimi MCP aracı sunulmaz.

- Etkin kayıtlı **v2 HTTP depolarını**, **Compose sınıfındaki** girdileri ve sunucunun seçtiği
  tam **amd64/arm64** Compose varyantlarını destekler. Desteklenmeyen sınıf, hatalı ayrıntı,
  kimlik/mimari uyuşmazlığı veya kanonik olmayan yol fail-closed davranır; alternatif indirme yoktur.
- Doğrulanmış `x-casaos.id` korunur; seçilen `x-casaos.repo_id` yalnızca yoksa eklenir.
  Deterministik son baytlar analiz edilir, dry-run ile doğrulanır, riskliyse onaylanır ve değiştirilmeden
  gönderilir. Store kökeni modern onayı atlamaz. `uncontrolled=false` ve port kontrolü içeride zorunludur;
  `ALLOW_APP_INSTALL` açıldığında iki kurulum aracı da açılır.
- Dry-run öncesinde desteklenen ilişkilendirme okumalarıyla en fazla 128 kurulu uygulama taranır.
  Mevcut kanonik katalog kimliği, depo veya proje adından bağımsız olarak çakışır. Okunamayan, hatalı
  veya belirsiz ilişkilendirme kanıtı ve sınırı aşan listeler kurulumu engeller; güncelleme başlatmaz.
  İlişkilendirme okumaları içeride yalnızca kimlik metadata'sını sunar; kimlik bilgisi içeren ham Compose,
  mevcut herkese açık okuma yolunda engellenmeye devam eder.
- Compose kurulumu ile process-local sıralama/ad rezervasyonlarını paylaşır; yerel katalog kimliklerini
  de rezerve eder. Kabul edilen veya belirsiz denemeler, kaldırma sonrasında da sunucu yeniden başlayana
  kadar rezerve kalır; kesin ret rezervasyonları bırakır. Belirsiz sonuçtan sonra yeniden başlatmadan
  önce gerçek host durumunu doğrulayın. Rezervasyonlar sınırlıdır ve sınır dolunca fail-closed davranır;
  kalıcı veya process'ler arası kilit değildir ve harici aktör yarışlarını engelleyemez.
- En fazla bir gerçek kurulum POST'u gönderir. `accepted`, asenkron kabul demektir; tamamlanma değildir.
  Bir anlık liste okuması ve tam proje görünüyorsa en fazla bir container okuması ile bir sağlık probu,
  `reconciliation: observed|pending|unknown` ve isteğe bağlı `appId`, `containerCount`, `health` üretir.
  Görünürlük, çalışan container'lar veya sağlık durumu gözlemdir; işlemin bütünüyle tamamlandığını kanıtlamaz.
  Bu araçta polling, değişiklik tekrar denemesi veya rollback yoktur.
