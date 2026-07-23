/**
 * Words that look like project names in titles but almost never are. The list is
 * deliberately conservative: a false negative just means the operator types the
 * name themselves, while a false positive pollutes the proposed project tree.
 */
const GENERAL = `
the a an and or but for with without from into onto about over under this that these those
new old next last first second final draft update updates fix fixes issue issues question questions
help how what why when where which who plan plans idea ideas note notes list summary summarize
error errors bug bugs test tests review setup install installation config configuration guide
project projects app application website site page pages code review file files folder data
today tomorrow yesterday week month year time day
ve veya ile için gibi ama fakat ancak çünkü daha çok az var yok olan olarak üzerine hakkında
yeni eski son ilk ikinci sonraki plan planı fikir fikirler not notlar liste özet
soru sorular yardım nasıl neden nerede hangi kim ne
hata hatalar sorun sorunlar düzelt düzeltme test kurulum ayar ayarlar rehber kılavuz
proje projesi uygulama site sayfa kod dosya dosyalar veri klasör
bugün yarın dün hafta ay yıl gün zaman
bir bu şu o çok biraz sadece hem her bazı
`
  .split(/\s+/)
  .filter(Boolean);

/**
 * Everyday programming vocabulary. These dominate conversation bodies and would
 * otherwise outrank real project names purely on volume.
 */
const PROGRAMMING = `
return null undefined true false void function method class object array string number boolean
type types interface enum const let var async await promise callback closure
get set add remove delete create update insert select query where join index key value
data model view controller service client server request response header footer body payload
error errors exception try catch throw log logs debug trace stack
user users login logout token session cookie auth password email mail
form button page route path url uri link image images icon color font size width height
list item items table row column card modal menu modal dialog input output
price order product category cart checkout payment invoice
search filter sort map reduce parse format validate render mount effect state props hook
build deploy run start stop restart script style styles theme layout component
sql schema migration seed backup restore
döndür dönüş değer değişken fonksiyon sınıf nesne dizi metin sayı
ekle sil güncelle kaydet getir listele göster gizle seç filtrele sırala
kullanıcı giriş çıkış şifre sunucu istek yanıt bağlantı
sayfa buton form alan resim görsel renk yazı boyut
fiyat sipariş ürün kategori sepet ödeme fatura
kur çalıştır durdur derle yayınla
`
  .split(/\s+/)
  .filter(Boolean);

/** Tooling and platform names that are context, not the user's own projects. */
const TECHNOLOGY = `
javascript typescript python java kotlin swift swiftui rust go golang php ruby
react vue angular svelte next nextjs node nodejs deno bun express nest
tailwind css html sass bootstrap
docker kubernetes nginx apache linux ubuntu macos windows ios android
git github gitlab bitbucket vercel netlify heroku aws azure gcp cloudflare supabase firebase
postgres postgresql mysql sqlite mongodb redis prisma
npm yarn pnpm vite webpack eslint prettier jest vitest
chatgpt claude codex openai anthropic gpt llm api rest graphql json yaml markdown
wordpress woocommerce shopify figma photoshop excel word powerpoint
macbook iphone ipad chrome safari firefox
jira trello slack notion asana confluence
xml csv xlsx pdf svg png jpg zip
mssql mariadb oracle odbc ftp sftp ssh smtp imap dns ssl https
ionic flutter dart electron unity blender
instagram facebook twitter whatsapp telegram linkedin tiktok youtube
`
  .split(/\s+/)
  .filter(Boolean);

/**
 * Directory names that carry no project meaning. Coding-session adapters derive
 * candidates from the working directory, so these would otherwise become notes.
 */
const DIRECTORY_NOISE = `
master main trunk develop dev temp tmp test tests demo sandbox scratch playground
src lib bin build dist out target vendor node_modules
repo repos work workspace workspaces projects project code codes
desktop downloads documents users home untitled new-project my-project
`
  .split(/\s+/)
  .filter(Boolean);

/** Frequent Turkish nouns that survive as capitalized words in titles. */
const TURKISH_NOUNS = `
tasarım görsel resim hata mesaj sohbet cevap yanıt konu başlık içerik metin
kod yazı renk liste rapor sunum tablo grafik logo afiş broşür şablon
selamlaşma açıklama örnek öneri yorum çeviri düzenleme
ahşap mobilya kahve yemek tarif
`
  .split(/\s+/)
  .filter(Boolean);

export const STOPWORDS = new Set([
  ...GENERAL,
  ...PROGRAMMING,
  ...TECHNOLOGY,
  ...DIRECTORY_NOISE,
  ...TURKISH_NOUNS,
]);

// Longest first so "ları" wins over "ı".
const TURKISH_SUFFIXES = [
  "larında", "lerinde", "larını", "lerini", "ları", "leri", "larda", "lerde",
  "lardan", "lerden", "nın", "nin", "nun", "nün", "ın", "in", "un", "ün",
  "sı", "si", "su", "sü", "da", "de", "ta", "te", "dan", "den", "tan", "ten",
  "yı", "yi", "yu", "yü", "ı", "i", "u", "ü", "a", "e",
];

/** Strip one common Turkish possessive/case suffix, if the stem stays usable. */
function stripTurkishSuffix(token: string): string {
  for (const suffix of TURKISH_SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

export function isStopword(token: string): boolean {
  // Check both foldings so Turkish dotted/dotless i does not slip past the list,
  // then retry against a suffix-stripped stem ("Tasarımı" → "tasarım").
  const lower = token.toLowerCase();
  const localized = token.toLocaleLowerCase("tr");
  // Punctuation-free form so "Next.js" matches the listed "nextjs".
  const bare = lower.replace(/[^\p{L}\p{N}]+/gu, "");
  return (
    STOPWORDS.has(lower) ||
    STOPWORDS.has(localized) ||
    STOPWORDS.has(bare) ||
    STOPWORDS.has(stripTurkishSuffix(lower)) ||
    STOPWORDS.has(stripTurkishSuffix(localized))
  );
}
