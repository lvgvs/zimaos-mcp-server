# ZimaOS MCP Server

[English README](README.md)

> **Yapay zekâ geliştirme bildirimi:** Bu proje GPT-5.6 Sol, GPT-6 Sol, GPT-6.1 Sol ve
> Qwen3.8-27B kullanılarak geliştirilmiştir. İnsan denetimi yönlendirme, kapsam/güvenlik
> kararları ve sürüm kararlarıyla sınırlı kalmıştır; kod tabanı bağımsız olarak bir insan
> tarafından satır satır incelenmemiştir.

MCP destekli yapay zekâ istemcilerinin ZimaOS Compose uygulamalarını küçük, tipli ve izin
kontrollü bir API yüzeyi üzerinden incelemesini ve yönetmesini sağlayan bir Model Context
Protocol (MCP) sunucusudur.

```text
MCP istemcisi → kimlik doğrulamalı MCP sunucusu → izin/güvenlik katmanı
              → tipli ZimaOS API soyutlaması → desteklenen ZimaOS API'leri
```

ZimaOS kimlik bilgilerini tutan tek bileşen bu sunucudur. Ürün; keyfî shell çalıştırma,
Docker socket erişimi, ayrıcalıklı container erişimi veya ZimaOS'un dahili
dosya/veritabanlarının doğrudan değiştirilmesini sunmaz.

**Güncel sürüm: [v0.4.0](https://github.com/lvgvs/zimaos-mcp-server/releases/tag/v0.4.0).**
Sürüm, aşağıdaki 21 aracın tamamını; korumalı cihaz yeniden başlatmayı, sistem kaynakları ve
işletim sistemi güncelleme okumalarını ve `/health` içinde kanonik çalışma zamanı sürümünü içerir.

## Yetenekler

- **Kurulu uygulamaları inceleme:** Compose uygulamalarını listeleme; normalize edilmiş
  uygulama ayrıntılarını, container/service bilgilerini, mevcut sağlık bilgilerini ve
  sınırlandırılmış son uygulama loglarını okuma.
- **App Store'dan keşif ve kurulum:** güvenilir kayıtlı kataloglarda arama, tam depo/uygulama
  girdilerini inceleme ve desteklenen kayıtlı girdilerden doğrudan uygulama kurma.
- **Compose ile çalışma:** çağıranın sağladığı Compose ile uygulama kurma, mevcut uygulama
  Compose'unu okuma, yeni Compose'u kurulumdan önce ve mevcut uygulama için önerilen Compose
  değişikliklerini uygulamadan önce doğrulama.
- **Kurulu uygulamaları yönetme:** uygulamaları başlatma, durdurma ve yeniden başlatma;
  mevcut uygulama Compose'unu güvenlik, eski durum ve risk kontrolleri altında düzenleme;
  mevcut yapılandırmayı koruma isteği ve belgelenmiş saklama sınırlamalarıyla uygulama kaldırma.
- **Sistem tanılama bilgilerini okuma:** ZimaOS sistem bilgilerini, örneklenmiş CPU/bellek ve
  sistem dosya sistemi kaynaklarını, desteklenen işletim sistemi güncelleme bildirimlerini
  ve kurucu durumunu inceleme.
- **Cihazı yeniden başlatma:** ayrı, varsayılan olarak kapalı bir izinle ZimaOS'un
  desteklenen API'si üzerinden yeniden başlatma isteme. Uygulamalar ve bağlantılar kesilir.
- **Değişiklik izinlerini bağımsız seçme:** tüm değişiklik yetenekleri ayrı, varsayılan olarak
  kapalı izinlerin arkasındadır; salt okunur yetenekler bu izinler kapalıyken de kullanılabilir.

## ZimaOS kurulumu

Hedef kurulum akışı ZimaOS'un normal Custom App arayüzüdür:

1. ZimaOS uygulama arayüzünü açın.
2. **Install a customized application** seçeneğini açın.
3. **Docker Compose / YAML import** seçeneğini seçin.
4. Seçtiğiniz [GitHub sürümüne](https://github.com/lvgvs/zimaos-mcp-server/releases) ekli
   Compose YAML dosyasını indirin ve içeriğini yapıştırın.
5. Tüm `CHANGE_ME_...` placeholder değerlerini değiştirin.
6. Varsayılan olarak kapalı izin değişkenlerini gözden geçirin.
7. Kurulumu başlatın.

Compose dosyası, container'ın ZimaOS API'sine host networking, Docker socket, privileged
mode veya host mount kullanmadan ulaşabilmesi için `host.docker.internal:host-gateway`
kullanır.

Kaynak deposu ve GHCR paketi herkese açıktır; registry kimlik bilgileri gerekmez.
YAML’a registry kimlik bilgileri eklemeyin veya desteklenen kurulum akışını host-shell
kontrolüyle değiştirmeyin. Sürüm Compose dosyaları, ilgili sürümün imaj digest'ini sabitler.
Depodaki [`deploy/zimaos/docker-compose.yml`](deploy/zimaos/docker-compose.yml), `edge`
kullanan bir geliştirme şablonudur; kararlı sürüm kurulum hedefi değildir. Tam olarak sabit
deployment için seçtiğiniz sürüm kaydındaki `ghcr.io/lvgvs/zimaos-mcp-server@sha256:<digest>`
referansını kullanın.

### Docker ile yerelde çalıştırma

```bash
docker build -t zimaos-mcp-server:local .

docker run --rm \
  --env-file /path/to/your.env \
  -p 3900:3000 \
  zimaos-mcp-server:local
```

## Yapılandırma

| Değişken               | Zorunlu | Açıklama                                                                                                 |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `ZIMAOS_URL`           | evet    | ZimaOS web/API temel adresi, ör. `http://host.docker.internal`.                                          |
| `ZIMAOS_USERNAME`      | evet    | Desteklenen uygulama/sistem API'leri için kullanılacak ZimaOS hesabı.                                    |
| `ZIMAOS_PASSWORD`      | evet    | Bu ZimaOS hesabının parolası.                                                                            |
| `MCP_AUTH_TOKEN`       | evet    | MCP istemcileri için Bearer token; en az 32 karakter, varsayılan yok.                                    |
| `ALLOW_APP_CONTROL`    | hayır   | Start/stop/restart işlemlerini açar; varsayılan `false`.                                                 |
| `ALLOW_APP_INSTALL`    | hayır   | Compose ve yerel App Store kurulumunu açar; varsayılan `false`.                                          |
| `ALLOW_APP_UNINSTALL`  | hayır   | Exact-id kaldırmayı açar; varsayılan `false`.                                                            |
| `ALLOW_APP_EDIT`       | hayır   | Mevcut uygulama Compose düzenlemesini açar; varsayılan `false`.                                          |
| `ALLOW_SYSTEM_CONTROL` | hayır   | Bağlantıları kesen cihaz yeniden başlatmayı açar; varsayılan `false`, uygulama izinlerinden bağımsızdır. |
| `PORT`                 | hayır   | Container iç HTTP portu; varsayılan `3000`.                                                              |
| `LOG_LEVEL`            | hayır   | `debug`, `info`, `warn` veya `error`; varsayılan `info`.                                                 |

Tam örnek için [`.env.example`](.env.example) dosyasına bakın. Gerçek kimlik bilgilerini
veya tokenları commit etmeyin.

`ZIMAOS_URL`, HTTP(S) origin'i (protokol, host ve isteğe bağlı port) olmalıdır; URL içinde
kimlik bilgisi, yol öneki, query veya fragment kabul edilmez. Sondaki slash kaldırılır.
`PORT` verilirse 1–65535 arasında tam bir ondalık tamsayı olmalıdır; boş değerler, sayıdan
sonra eklenen karakterler, kesirler ve üslü gösterim reddedilir. Kimlik bilgisi/token
değerleri, dağıtılan `CHANGE_ME` / `REPLACE_ME` placeholder'larını değiştirmelidir; bearer
tokenlarında boşluk olamaz. Doğrulama hataları, değeri yansıtmadan ayarın adını belirtir.

## MCP istemcisi bağlama

Sunucu Streamable HTTP endpoint'ini şu adreste sunar:

```text
http://<zima-host>:3900/mcp
```

MCP istemcisini şu başlığı gönderecek şekilde yapılandırın:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Araç referansı

| Araç                                     | Değişiklik yapar mı? | Not                                                                                          |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `list_apps`                              | hayır                | Kurulu Compose uygulamalarını listeler.                                                      |
| `get_app`                                | hayır                | Tek uygulama için normalize edilmiş ayrıntılar.                                              |
| `search_app_store`                       | hayır                | Etkin kayıtlı v2 HTTP Compose kataloglarında sınırlı arama.                                  |
| `get_app_store_details`                  | hayır                | Güvenilir tam depo/uygulama çifti için herkese açık metadata.                                |
| `get_app_health`                         | hayır                | ZimaOS'un sunduğu ölçüde uygulama/container sağlık bilgisi.                                  |
| `get_app_logs`                           | hayır                | Sınırlandırılmış son loglar; varsayılan 100, maksimum 500 satır.                             |
| `list_app_containers`                    | hayır                | Bir uygulamaya ait container/service bilgisi.                                                |
| `get_system_info`                        | hayır                | Küçük normalize edilmiş ZimaOS sistem özeti.                                                 |
| `get_system_resources`                   | hayır                | Mevcut örneklenmiş CPU/bellek/sistem dosya sistemi ölçümleri; ağ veya sağlık kararı yoktur.  |
| `get_os_update_status`                   | hayır                | İşletim sistemi sürümleri, bildirim sınıfı, kurucu durumu ve beta aboneliği.                 |
| `restart_device`                         | evet                 | `ALLOW_SYSTEM_CONTROL=true` gerekir; tek yeniden başlatma isteği, kabul tamamlanma değildir. |
| `validate_app_compose`                   | hayır                | Yerel risk analizi + resmi ZimaOS dry run.                                                   |
| `get_app_compose`                        | hayır                | Interpolate edilmiş Compose + SHA-256 fingerprint. Çıktıyı hassas kabul edin.                |
| `validate_app_compose_change`            | hayır                | Önerilen değişikliği risk delta ve stale-base kontrolleriyle doğrular.                       |
| `start_app` / `stop_app` / `restart_app` | evet                 | `ALLOW_APP_CONTROL=true` gerekir.                                                            |
| `install_app_from_compose`               | evet                 | `ALLOW_APP_INSTALL=true` gerekir; riskli değişiklikler onay ister.                           |
| `install_app_from_store`                 | evet                 | Aynı kurulum izni; yalnızca kayıtlı katalog kimlikleriyle kontrollü, tek denemelik kurulum.  |
| `uninstall_app`                          | evet                 | `ALLOW_APP_UNINSTALL=true` gerekir; `delete_config_folder=false` gönderir.                   |
| `edit_app_compose`                       | evet                 | `ALLOW_APP_EDIT=true` gerekir; optimistic base-fingerprint kontrolü kullanır.                |

## İzinler ve güvenlik

- **MCP kimlik doğrulaması zorunludur.** Her MCP isteği `MCP_AUTH_TOKEN` ile eşleşen
  `Authorization: Bearer <token>` başlığını taşımalıdır.
- **Varsayılan MCP sırrı yoktur.** `MCP_AUTH_TOKEN` en az 32 karakter olmalıdır.
- **ZimaOS kimlik bilgileri MCP istemcilerine döndürülmez.**
- **Değişiklik izinleri bağımsızdır ve varsayılan olarak kapalıdır.**
- **Riskli Compose işlemleri fail-closed davranır.** Riski artıran kurulum/düzenleme
  istekleri değişiklikten önce modern MCP onay akışını gerektirir.
- **Kabul edilen install/edit/uninstall denemelerinde en fazla bir değişiklik isteği
  gönderilir.** Belirsiz sonuçlar otomatik olarak tekrar denenmez.
- **Shell, SSH control plane, Docker socket, privileged sunucu modu veya ZimaOS dahili
  depolamasına doğrudan müdahale yoktur.**

Sunucu TLS'i kendisi sonlandırmaz. Güvenilir bir LAN/VPN'de veya doğru yapılandırılmış bir
HTTPS reverse proxy arkasında kullanın; düz HTTP portunu doğrudan internete açmayın.
Bearer kimlik doğrulaması, taşıma katmanı şifrelemesi değildir.

### Riskli işlem onayı

Riski artıran Compose kurulum/düzenleme istekleri modern istemcilerde yerel MCP
`input_required` / form elicitation akışını kullanır. Onay durumu kısa ömürlü, imzalı, tam
içeriğe bağlı ve tek kullanımlıktır. Sunucu değişiklikten hemen önce güncel durumu yeniden
kontrol eder.

Bu mekanizma, açıklamanın gerçekten bir insana gösterildiğini kriptografik olarak
kanıtlayamaz; onay arayüzünü doğru şekilde göstermek MCP istemcisinin sorumluluğudur.
Bekleyen onay durumu process-local'dır ve sunucu yeniden başlatıldığında kaybolur.

## Önemli kullanım bilgileri

### App Store keşfi ve kurulumu

Arama boş olmayan metin gerektirir; boş sorguyla gezinme desteklenmez. Ayrıntı veya kurulum
için dönen `repo_id` ve `app_id` çiftini birlikte kullanın; görünen adları veya URL’leri değil.
Arama sınırlı ve bulanıktır, İngilizce yerelleştirme kullanır; `truncated`, katalog genelinde
eksiksizlik değil dışarıda kalan sonuçları belirtir. Katalog metni güvenilmeyen veridir, talimat
değildir; bildirilen mimari kurulum garantisi değildir. Keşif kurulu olma veya güncelleme
uygunluğu durumunu bildirmez.

Yerel kurulum yalnızca etkin kayıtlı v2 HTTP depolarını, Compose sınıfındaki girdileri ve
sunucunun seçtiği amd64/arm64 varyantlarını destekler. URL, sürüm, mimari, force, update veya
downgrade override’ı yoktur. Store kökeni risk onayını atlamaz. Mevcut kimlik çakışmaları veya
okunamayan/belirsiz ilişkilendirme kanıtı kurulumu engeller; güncelleme başlatmaz.
Kabul edilen/belirsiz yerel kimlik rezervasyonları kaldırma sonrasında da sunucu yeniden başlayana
kadar kalır; belirsiz sonuçtan sonra yeniden başlatmadan önce gerçek host durumunu doğrulayın.

Girdi/çıktı sınırları, kimlik doğrulama, kontrollü kurulum ve sınırlı uzlaştırma için
[App Store sözleşmeleri ve güvenlik ayrıntılarına](docs/TOOL-USAGE.tr.md#app-store-keşfi) bakın.

### Sistem tanılama

İki tanılama aracı yalnızca `{}` kabul eder; yenileme, abonelik değişikliği, durum sıfırlama,
kurulum veya yeniden başlatma değil okuma yapar. Eksik ölçümler atlanır, sıfır/sağlıklı varsayılanla
doldurulmaz. CPU/bellek değerleri örnektir; sistem depolama havuzları değil yalnızca sistem dosya
sistemini kapsar. Sıcaklık ve sağlık kararları sunulmaz. `updateAvailable`, sürüm karşılaştırması
veya kurulum uygunluğuna değil Installer bildirimine dayanır; `idle` tamamlanmayı kanıtlamaz.
Ardışık işletim sistemi okumaları atomik değildir. Ham notlar/mesajlar ve yaklaşık ilerleme atlanır.
[Tanılama alanları, sınırları ve semantiğine](docs/TOOL-USAGE.tr.md#sistem-tanılama) bakın.

### Cihazı yeniden başlatma

`restart_device` yalnızca `{}` kabul eder ve yapılandırılmış ZimaOS host'unun bir kez yeniden
başlatılmasını ister. `ALLOW_SYSTEM_CONTROL` iznini yalnızca tüm uygulamalar ve bağlantıların
kesilmesine izin vermek istiyorsanız açın; uygulama izinleri bu yetkiyi açmaz. Sunucu kimlik
doğrulama reddi, zaman aşımı veya bağlantı kesilmesi dahil hiçbir durumda yazmayı otomatik
tekrarlamaz. `status:"accepted"`, API'nin isteği kabulüdür; yeniden başlatmanın tamamlanması
değildir. `status:"unknown"`, yeniden başlatma zaten gerçekleşmiş olsa da dönebilir.
`completion` her zaman `"unverified"`, `retrySafe` her zaman `false` değerindedir. Başka bir
açık çağrı düşünmeden önce host durumunu bağımsız olarak doğrulayın. Kapatma, keyfî sistem
durumu, shell veya işletim sistemi kurulum işlemi sunulmaz.

### Hazır olma ve başlatma

`/health`, degraded yanıtlar dahil `status`, `service` ve `ready` yanında paket bilgisinden
türetilen kanonik `version` alanını içerir. Kimlik doğrulaması gerektirmez ve container health/readiness kontrolleri
içindir; MCP endpoint'i değildir. Desteklenen, kimlik doğrulamalı ZimaOS cihaz bilgisi
API'sini aktif olarak kontrol eder. Zaten çalışan sunucuda HTTP 200 hazır, HTTP 503 ise
upstream erişilemezliği veya kimlik doğrulama hatası dahil degraded readiness anlamındadır.
Eşzamanlı kontroller sınırlı upstream işlemini paylaşır.
Docker, yapılandırılan container iç `PORT` değerini kontrol eder ve degraded durumunu
unhealthy sayar; bu, her uygulama API'sinin çalıştığı garantisi değildir.

İlk başlatmada hatalı ZimaOS kimlik bilgileri veya erişilemeyen `ZIMAOS_URL`, MCP/health
HTTP listener açılmadan fail-fast davranışına neden olur. Bu başlangıç hatalarında
`/health` 503 yerine connection refused görülmesi beklenir. Gizli bilgi içermeyen
`zimaos_login_failed` log kodunu kontrol edip yapılandırmayı düzeltin; hatalı parolayla
tekrarlanan restart denemeleri ZimaOS tarafında rate limiting tetikleyebilir.

## Uyumluluk ve sınırlamalar

Endpoint, modern MCP `2026-07-28` ve stateless legacy istemcileri destekler. Legacy
istemciler salt okunur araçları ve izin verilen risksiz işlemleri kullanabilir; riskli
kurulum/düzenleme istekleri ise fail-closed davranır. Riskli işlem onayı, form elicitation
ve yerel `input_required` / `requestState` çok turlu istek akışını destekleyen modern bir
istemci gerektirir; legacy onay shim'i veya metinle onaylama bypass'ı yoktur.

**Inspector Web arayüzü:** Inspector sayfasını tarayıcının çalıştığı makinedeki
`http://localhost` / loopback adresinden veya güvenilir HTTPS üzerinden açın. LAN IP'si
üzerindeki düz HTTP, tarayıcı için güvenli bağlam değildir. Inspector 2.9.0, istek takibi
için `crypto.randomUUID()` gerektirir; bu API kullanılamadığında modern discovery, bu
sunucuya hiçbir istek ulaşmadan başarısız olup "the server did not offer pinned protocol
version" hatasını gösterebilir. Bu gereksinim uzak MCP endpoint'ine değil, Inspector
sayfasının origin'ine aittir. Tarayıcı konsolunda `window.isSecureContext` ve
`typeof crypto.randomUUID` değerlerini kontrol edin; tarayıcı güvenliğini devre dışı
bırakmayın. Modern Inspector bağlantıları için `--protocol-era modern` seçeneğini açıkça
belirtin.

- `accepted`, ZimaOS'un asenkron isteği kabul ettiği anlamına gelir; işlemin
  tamamlandığını **kanıtlamaz**.
- `update_app`, desteklenen App Store update/version-transition semantiği doğrulanmadığı
  için bilinçli olarak uygulanmamıştır.
- Mevcut uygulama Compose düzenlemeleri için doğrulanmış genel bir rollback garantisi
  yoktur.
- ZimaOS Compose düzenlemeleri için atomik compare-and-swap sunmaz; başka bir aktör son
  okuma ile apply arasında yarışabilir.
- Riskli onay/lock durumu process-local'dır; multi-replica koordinasyon tasarımı değildir.
- `uninstall_app` açıkça `delete_config_folder=false` ister ancak upstream
  storage-retention semantiği bağımsız olarak doğrulanmamıştır.
- Uygulama logları uygulamanın kendisi tarafından üretilen gizli bilgiler içerebilir; log
  çıktısını buna göre değerlendirin.

## İmaj referansları ve sürüm politikası

- `sha-<tam-commit>`, CI'ın ilk yayınladığı çıktıyı korur; yeniden çalıştırmalar imajı
  yeniden derlemek yerine bu çıktıyı kullanır.
- `edge`, CI ile doğrulanmış güncel geliştirme çıktısıdır; kararlı sürüm değildir.
- Onaylı `v<sürüm>` imaj etiketleri o commit'in mevcut digest'ini yeniden derlemeden taşır.
  Kararlı sürümler `stable` / `latest` etiketlerini de ilerletir; ön sürümler yalnızca
  `prerelease` etiketini ilerletir.
- Tam olarak sabit deployment/UAT için `image@sha256:<digest>` kullanın: registry
  yöneticileri etiketleri değiştirebilir; politika ile korunan etiketler registry'nin
  zorunlu tuttuğu bir değişmezlik garantisi değildir.
- Derlemeler Node 22 taban digest'ini sabitler; revision/source etiketleri, asgari provenance
  ve SBOM yayınlar. Aynı kaynağı yeniden derlemenin aynı baytları üretmesi **garanti edilmez**.

Yayın sözleşmesi ve tarihsel doğrulamalar için [bakımcı sürüm kayıtlarına](docs/RELEASE.md) bakın.

## Geliştirme

Node.js 22 LTS (22.13.0 veya daha yeni) ya da desteklenen daha yeni bir LTS runtime kullanın.

```bash
npm ci --no-audit --no-fund
npm run format:check
npm run lint
npm run typecheck
npx tsc -p tsconfig.test.json --noEmit
npm test
npm run build
```

Otomatik testler mock/fake bileşenler ve yerel HTTP test sunucuları kullanır. Canlı ZimaOS
entegrasyon testleri ayrıdır ve commit edilmiş kimlik bilgilerine bağlı değildir.

## Belgeler

- [Sürümler](https://github.com/lvgvs/zimaos-mcp-server/releases) ve [v0.4.0 notları](docs/RELEASE-NOTES-v0.4.0.md).
- [Araç kullanımı ve güvenlik semantiği](docs/TOOL-USAGE.tr.md).
- [Katkıda bulunma](CONTRIBUTING.md) — katkıda bulunanlar için kurulum, kontroller ve pull request yönergeleri.
- [Güvenlik politikası](SECURITY.md) — güvenlik açığı bildirimi ve bakım politikası.
- [Değişiklik günlüğü](CHANGELOG.md) — kullanıcıya yönelik sürüm geçmişi.

### Mühendislik başvuru kaynakları

Bu kayıtlar geliştirme geçmişini ve bakımcı/ajan süreçlerini açıklar; ek kurulum gereksinimleri
veya kullanıcı yetenekleri tanımlamaz.

- [`PROJECT.md`](PROJECT.md) — onaylı ürün kapsamı ve faz sınırları.
- [`STATUS.md`](STATUS.md) — güncel geliştirme/sürüm durumu ve tarihsel checkpoint'ler.
- [`DECISIONS.md`](DECISIONS.md) — mimari kararlar.
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — doğrulanmış API/protokol araştırmaları ve
  uygulama sonuçları.
- [`AGENTS.md`](AGENTS.md) — implementation agent'ları için repo çalışma kuralları.

## Lisans

Apache-2.0. Ayrıntılar için [`LICENSE`](LICENSE). Üçüncü taraf bağımlılıklar kendi
lisanslarını korur.
