# Vulcanus — Kalan Geliştirme TODO'ları

Öncelikler: **P0** = temel/acil, **P1** = büyük değer katar, **P2** = vizyon/uzun vade.
Efor: S (saatler), M (1–2 gün), L (hafta+).

> **Durum:** İlk 5 sprint `main`'e merge edildi (PR #3). Ardından bu listedeki
> P0/P1 işlerinin tamamı ve P2'nin doküman kısmı bitti: release otomasyonu,
> Windows CI düzeltmesi, `stats`, `--verbose/--quiet`, shell completion, hata
> formatı + çıkış kodları, `sync --json/--watch`, `hooks install`, MCP
> derinleştirme, protokol versiyonlama, skill senkron denetimi, üç yeni importer
> + artımlı import, 140 test, CONTRIBUTING + şablonlar, docs sitesi ve benchmark
> yazısı.
>
> **Sıradaki:** 0.4.0 yayını. Sürüm damgalandı (package.json, `src/version.ts`,
> CHANGELOG), `NPM_TOKEN` ve `npm-publish` environment'ı hazır; kalan tek adım
> `v0.4.0` tag'ini push etmek. npm'deki son sürüm hâlâ 0.3.3.
>
> Aşağıdaki liste yalnızca **kalan** işlerdir. Bilerek yapılmayanlar en altta,
> gerekçeleriyle.

---

## 1. Altyapı & Kalite (P0)

- [x] **Feature branch'i merge et** — PR #3 `main`'e merge edildi. *(S)*
- [x] **Test coverage eşiği** — CI'da ayrı `coverage` job'ı; `npm run
  coverage:check` eşikleri zorluyor (lines 85 / branches 75 / functions 80). *(S)*
- [x] **Release otomasyonu** — `npm run release -- <sürüm|major|minor|patch>`
  `package.json`, `src/version.ts` ve CHANGELOG başlığını birlikte günceller;
  `v*` tag'i push'lanınca `.github/workflows/release.yml` bütün kontrolleri
  tekrar koşup `npm publish --provenance` yapıyor ve GitHub release notlarını
  elle yazılmış CHANGELOG bölümünden üretiyor. Sürüm sapmasını test yakalıyor.
  *(release-please/changesets değil: CHANGELOG burada elle yazılmış düzyazı,
  conventional-commit üretimi onu bozardı.)* *(M)*
- [x] **Dependabot** — `.github/dependabot.yml`: haftalık npm + github-actions,
  dev/prod grupları. *(S)*
- [x] **`exports` alanı ekle** — `src/index.ts` barrel'ı, `exports`/`main`/`types`
  map'i ve `.d.ts` üretimi. *(S)*
- [x] **Windows yol güvenliği** — Windows CI aslında **kırmızıydı**: `node --test
  test/*.test.ts` shell glob'una dayanıyor, PowerShell genişletmiyor, yani hiçbir
  test koşmuyordu. Dosya listesi artık `scripts/run-tests.mjs` içinde JavaScript
  tarafında genişliyor. Ayrıca dosya sisteminden gelen yollar `vaultRelative()`
  ile "/" formuna normalize ediliyor. *(M)*

## 2. Test Genişletme (P1)

- [x] **Importer edge-case'leri** — boş export, bozuk JSON batch, yarım yazılmış
  JSONL satırı, exotic unicode başlıklar, her adapter'ın kendine ait olmayan
  dizini reddetmesi. *(M)*
- [x] **MCP server transport testi** — `InMemoryTransport` ile gerçek client;
  tool listesi, açıklama kalitesi, `recall`, hata yolu ve `append_decision`. *(S)*

## 3. CLI UX (P1)

- [x] **`--json` çıktısını yaygınlaştır** — `sync --json` (doctor sonucu, bekleyen
  değişiklikler, commit hash, push gerçekten oldu mu) ve `import --json`
  (adaylar + kanıt, hiçbir şey yazmadan). *(S)*
- [x] **`--verbose` / `--quiet`** — global seviye, `src/ui.ts` üzerinden.
  `--json` otomatik quiet: makine çıktısı stdout'u tek başına sahiplenir. *(S)*
- [x] **Shell completion** — `vulcanus completion bash|zsh|fish|pwsh`, tek bir
  komut tanımından üretiliyor. *(S)*
- [x] **Hata mesajlarını zenginleştir** — `src/errors.ts`: her hata "ne oldu /
  neden / ne yapmalı"; çıkış kodları (`0/1/2/130`) sözleşme olarak `--help`'te ve
  README'de. *(M)*
- [x] **`vulcanus stats`** — cold start, tipik recall ve tüm vault maliyeti; proje
  başına capsule/cluster. `--json` var. *(M)*

## 4. Ajan Entegrasyonu (P1–P2)

- [x] **MCP server'ı derinleştir** — `update_capsule` (tek bölüm, kör dosya
  yazımı yok), `append_rule`, ve capsule bayatsa `recall` cevabında uyarı. *(M)*
- [x] **`vulcanus sync --watch`** — her düzenlemede managed dosyaları yeniden
  üretip grafı doğruluyor; commit/push **yapmıyor** (bilerek). *(M)*
- [x] **Git hook entegrasyonu** — `vulcanus hooks install/uninstall`,
  `core.hooksPath` uyumlu, başkasının hook'unu `--force` olmadan ezmiyor. *(S)*
- [x] **Skill senkron denetimi** — `.claude/skills/` ↔ `.agents/skills/` kopyaları
  saparsa `doctor` uyarıyor. *(S)*
- [x] **`serve` için skill/doküman** — USING-WITH-AI.md'de MCP bölümü ve üretilen
  vault'larda `<vault>-serve` skill'i. *(S)*
- [x] **AGENTS.md protokol versiyonlama** — AGENTS.md'de protokol damgası;
  `doctor` eski protokolü uyarıyor, CLI'dan yeni protokolü reddediyor. *(M)*

## 5. Importer Genişletme (P1)

- [x] **Gemini CLI oturumları** — `~/.gemini/tmp/**/logs.json` + kaydedilmiş
  `checkpoint-<tag>.json` sohbetleri. *(M)*
- [x] **Cursor oturumları** — workspace başına `state.vscdb`; proje sinyali
  workspace klasörü. Node 22.5+ (`node:sqlite`) altında kendini "yok" diye
  bildiriyor, sessizce boş dönmüyor. *(M)*
- [x] **Genel Markdown/klasör importu** — klasör adları proje sinyali. Otomatik
  taranmıyor; yalnız yol verilince. *(M)*
- [x] **Artımlı import** — varsayılan davranış; okunan konuşma ID'leri vault'un
  state dizininde (manifest'te değil: binlerce ID diff'i okunamaz hale getirir),
  `--all` hepsini yeniden okur. *(M)*
- [ ] **`--ai` ile akıllı kümeleme** — kelime-frekans analizini, kurulu AI CLI'a
  konuşma özetletip kümeletme ile güçlendir (opt-in). *(L)*

## 6. i18n & Dokümantasyon (P2)

- [ ] **Üretilen notları da yerelleştir** — *(yeni, ve aşağıdaki iki i18n
  maddesinin ön koşulu)* Bugün yalnız sihirbaz çevrili; notlar locale ne olursa
  olsun İngilizce üretiliyor. *(L)*
- [ ] **String'leri dışa al** — `i18n.ts`'i locale-başına JSON'a böl. *(M)*
- [ ] **Yeni diller** — `de`, `es`. *(S/dil)*
- [x] **CONTRIBUTING.md + issue/PR şablonları** *(S)*
- [x] **Docs sitesi genişletme** — 13 komut, MCP bölümü. *(L → kısmi: SSS ve tam
  komut referansı hâlâ yok)*
- [ ] **Asciinema/VHS demo** — `init` akışının kaydı. *(S)*
- [ ] **Örnek vault repo'su** — `vulcanus-example-vault`. *(S)*

## 7. Dağıtım & Görünürlük (P2)

- [x] **npm provenance** — release workflow `--provenance` ile yayınlıyor
  (OIDC). *(S)*
- [x] **`NPM_TOKEN` secret'ı + `npm-publish` environment'ı** — tanımlandı.
  Environment'ta onay kuralı yok: tag push'lanır push'lanmaz yayın başlar. *(S)*
- [ ] **Homebrew tap** — ayrı repo gerekiyor. *(M)*
- [ ] **Sürüm duyuru otomasyonu** *(S)*
- [x] **Benchmark yazısı** — [`docs/token-budget.md`](docs/token-budget.md):
  6 projelik vault'ta ölçüm, yöntem ve **neyi kanıtlamadığı** açıkça yazılı. *(M)*

---

## Bilerek yapılmayanlar

- **i18n JSON'a çıkarma ve de/es** — üretilen notlar henüz yerelleştirilmediği
  için yeni bir sihirbaz dili yarım bir deneyim üretir (Almanca sihirbaz,
  İngilizce notlar). Doğru sıra: önce üretimi yerelleştir.
- **Asciinema demo, örnek vault repo'su, Homebrew tap, duyuru otomasyonu** —
  terminal kaydı, ayrı repo veya hesap erişimi gerekiyor; kod tarafında
  yapılabilecek bir şey yok.
- **npm 2FA** — hesap ayarı. Granular token CI için 2FA'yı baypas eder,
  hesaptaki 2FA açık kalır.

## Önerilen sıra

1. ~~Merge + coverage + Dependabot + `exports`~~ — **bitti**
2. ~~Release otomasyonu, Windows CI, stats, CLI UX, MCP derinleştirme,
   importer'lar, testler, docs~~ — **bitti**
3. **0.4.0'ı yayınla** — `git tag v0.4.0 && git push --follow-tags`
4. Üretilen notların yerelleştirilmesi → i18n dışa alma → yeni diller
5. `--ai` ile akıllı kümeleme; demo kaydı ve örnek vault repo'su
