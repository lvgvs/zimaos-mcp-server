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

## Proje durumu

**Ön sürüm.** Phase 1–3 işlevleri tamamlandı; Phase 4 sürüm sağlamlaştırma ve gerçek
kullanıcı UAT süreci devam ediyor. İlk etiketli sürüm henüz yayınlanmadı.

`latest` şu anda geliştirme dalını takip eder ve kararlı sürüm olarak
değerlendirilmemelidir. İlk sürümden önce kurulum ayrıntıları ve release artifact'leri
değişebilir.

Güncel geliştirme durumu için [`STATUS.md`](STATUS.md), onaylı kapsam ve güvenlik
sınırları için [`PROJECT.md`](PROJECT.md) dosyasına bakın.

## Neler yapabilir?

### Salt okunur

- Kurulu uygulamaları listeleme ve tek bir uygulamayı inceleme.
- Uygulama/container sağlık durumunu ve sınırlandırılmış son logları okuma.
- Bir uygulamaya ait container/service bilgisini listeleme.
- Temel ZimaOS sistem bilgisini okuma.
- Compose'u kurulum yapmadan doğrulama.
- Mevcut bir uygulamanın interpolate edilmiş Compose'unu ve fingerprint'ini okuma.
- Mevcut uygulama için önerilen Compose değişikliğini uygulamadan doğrulama.

### Değişiklik yapan işlemler

Değişiklik yapan yetkiler birbirinden bağımsız ve varsayılan olarak kapalıdır:

| Yetenek                               | MCP araçları                           | Gerekli değişken      | Varsayılan |
| ------------------------------------- | -------------------------------------- | --------------------- | ---------- |
| Geri döndürülebilir uygulama kontrolü | `start_app`, `stop_app`, `restart_app` | `ALLOW_APP_CONTROL`   | `false`    |
| Compose kurulumu                      | `install_app_from_compose`             | `ALLOW_APP_INSTALL`   | `false`    |
| Uygulama kaldırma                     | `uninstall_app`                        | `ALLOW_APP_UNINSTALL` | `false`    |
| Mevcut uygulama Compose düzenleme     | `edit_app_compose`                     | `ALLOW_APP_EDIT`      | `false`    |

Salt okunur araçlar bu değişkenlerin hiçbirinden değişiklik yapma yetkisi devralmaz.

## Güvenlik modeli

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

### Riskli işlem onayı

Riski artıran Compose kurulum/düzenleme istekleri modern istemcilerde yerel MCP
`input_required` / form elicitation akışını kullanır. Onay durumu kısa ömürlü, imzalı, tam
içeriğe bağlı ve tek kullanımlıktır. Sunucu değişiklikten hemen önce güncel durumu yeniden
kontrol eder.

Bu mekanizma, açıklamanın gerçekten bir insana gösterildiğini kriptografik olarak
kanıtlayamaz; onay arayüzünü doğru şekilde göstermek MCP istemcisinin sorumluluğudur.
Bekleyen onay durumu process-local'dır ve sunucu yeniden başlatıldığında kaybolur.

## ZimaOS kurulumu

Hedef kurulum akışı ZimaOS'un normal Custom App arayüzüdür:

1. ZimaOS uygulama arayüzünü açın.
2. **Install a customized application** seçeneğini açın.
3. **Docker Compose / YAML import** seçeneğini seçin.
4. [`deploy/zimaos/docker-compose.yml`](deploy/zimaos/docker-compose.yml) içeriğini
   yapıştırın.
5. Tüm `CHANGE_ME_...` placeholder değerlerini değiştirin.
6. Varsayılan olarak kapalı izin değişkenlerini gözden geçirin.
7. Kurulumu başlatın.

Compose dosyası, container'ın ZimaOS API'sine host networking, Docker socket, privileged
mode veya host mount kullanmadan ulaşabilmesi için `host.docker.internal:host-gateway`
kullanır.

> **Ön sürüm notu:** ZimaOS arayüzünden sıfırdan kurulum akışı ilk sürüm UAT sürecinde
> doğrulanmaktadır. İlk sürüm yayınlanana kadar `latest` kararlı deployment hedefi olarak
> değerlendirilmemelidir.

## Yapılandırma

| Değişken              | Zorunlu | Açıklama                                                              |
| --------------------- | ------- | --------------------------------------------------------------------- |
| `ZIMAOS_URL`          | evet    | ZimaOS web/API temel adresi, ör. `http://host.docker.internal`.       |
| `ZIMAOS_USERNAME`     | evet    | Desteklenen uygulama/sistem API'leri için kullanılacak ZimaOS hesabı. |
| `ZIMAOS_PASSWORD`     | evet    | Bu ZimaOS hesabının parolası.                                         |
| `MCP_AUTH_TOKEN`      | evet    | MCP istemcileri için Bearer token; en az 32 karakter, varsayılan yok. |
| `ALLOW_APP_CONTROL`   | hayır   | Start/stop/restart işlemlerini açar; varsayılan `false`.              |
| `ALLOW_APP_INSTALL`   | hayır   | Compose kurulumunu açar; varsayılan `false`.                          |
| `ALLOW_APP_UNINSTALL` | hayır   | Exact-id kaldırmayı açar; varsayılan `false`.                         |
| `ALLOW_APP_EDIT`      | hayır   | Mevcut uygulama Compose düzenlemesini açar; varsayılan `false`.       |
| `PORT`                | hayır   | Container iç HTTP portu; varsayılan `3000`.                           |
| `LOG_LEVEL`           | hayır   | `debug`, `info`, `warn` veya `error`; varsayılan `info`.              |

Tam örnek için [`.env.example`](.env.example) dosyasına bakın. Gerçek kimlik bilgilerini
veya tokenları commit etmeyin.

## MCP istemcisi bağlama

Sunucu Streamable HTTP endpoint'ini şu adreste sunar:

```text
http://<zima-host>:3900/mcp
```

MCP istemcisini şu başlığı gönderecek şekilde yapılandırın:

```http
Authorization: Bearer <MCP_AUTH_TOKEN>
```

`/health` kimlik doğrulaması gerektirmez ve container health/readiness kontrolleri
içindir; MCP endpoint'i değildir.

## Araç referansı

| Araç                                     | Değişiklik yapar mı? | Not                                                                           |
| ---------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| `list_apps`                              | hayır                | Kurulu Compose uygulamalarını listeler.                                       |
| `get_app`                                | hayır                | Tek uygulama için normalize edilmiş ayrıntılar.                               |
| `get_app_health`                         | hayır                | ZimaOS'un sunduğu ölçüde uygulama/container sağlık bilgisi.                   |
| `get_app_logs`                           | hayır                | Sınırlandırılmış son loglar; varsayılan 100, maksimum 500 satır.              |
| `list_app_containers`                    | hayır                | Bir uygulamaya ait container/service bilgisi.                                 |
| `get_system_info`                        | hayır                | Küçük normalize edilmiş ZimaOS sistem özeti.                                  |
| `validate_app_compose`                   | hayır                | Yerel risk analizi + resmi ZimaOS dry run.                                    |
| `get_app_compose`                        | hayır                | Interpolate edilmiş Compose + SHA-256 fingerprint. Çıktıyı hassas kabul edin. |
| `validate_app_compose_change`            | hayır                | Önerilen değişikliği risk delta ve stale-base kontrolleriyle doğrular.        |
| `start_app` / `stop_app` / `restart_app` | evet                 | `ALLOW_APP_CONTROL=true` gerekir.                                             |
| `install_app_from_compose`               | evet                 | `ALLOW_APP_INSTALL=true` gerekir; riskli değişiklikler onay ister.            |
| `uninstall_app`                          | evet                 | `ALLOW_APP_UNINSTALL=true` gerekir; `delete_config_folder=false` gönderir.    |
| `edit_app_compose`                       | evet                 | `ALLOW_APP_EDIT=true` gerekir; optimistic base-fingerprint kontrolü kullanır. |

## Önemli davranışlar ve sınırlamalar

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

## Docker ile yerelde çalıştırma

```bash
docker build -t zimaos-mcp-server:local .

docker run --rm \
  --env-file /path/to/your.env \
  -p 3900:3000 \
  zimaos-mcp-server:local
```

## Geliştirme

Node.js 22 veya daha yenisi gerekir.

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

## Proje belgeleri

- [`PROJECT.md`](PROJECT.md) — onaylı ürün kapsamı ve faz sınırları.
- [`STATUS.md`](STATUS.md) — güncel geliştirme/sürüm durumu ve tarihsel checkpoint'ler.
- [`DECISIONS.md`](DECISIONS.md) — mimari kararlar.
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — doğrulanmış API/protokol araştırmaları ve
  uygulama sonuçları.
- [`AGENTS.md`](AGENTS.md) — implementation agent'ları için repo çalışma kuralları.
- [`CHANGELOG.md`](CHANGELOG.md) — kullanıcıya yönelik sürüm değişiklik geçmişi.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — katkı ve geliştirme yönergeleri.
- [`SECURITY.md`](SECURITY.md) — güvenlik açığı bildirim politikası.

## Lisans

Apache-2.0. Ayrıntılar için [`LICENSE`](LICENSE). Üçüncü taraf bağımlılıklar kendi
lisanslarını korur.
