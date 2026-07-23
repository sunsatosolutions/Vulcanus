export type Locale = "tr" | "en";

export interface Messages {
  introTitle: string;
  introBody: string;

  localeQuestion: string;
  localeTr: string;
  localeEn: string;

  importQuestion: string;
  importHint: string;
  importNone: string;
  importNoneHint: string;
  importCustom: string;
  importCustomHint: string;
  importPathQuestion: string;
  importSourceQuestion: string;
  detecting: string;
  detected: (count: number) => string;
  noSourcesFound: string;
  reading: string;
  readDone: (conversations: number, candidates: number) => string;
  readFailed: (message: string) => string;

  candidatesTitle: string;
  candidatesHint: string;
  candidateLabel: (name: string, conversations: number, confidence: string) => string;
  manualProjectsQuestion: string;
  manualProjectsHint: string;
  projectListQuestion: string;
  projectListHint: string;
  noProjects: string;

  vaultSection: string;
  vaultNameQuestion: string;
  vaultNameHint: string;
  vaultFullNameQuestion: string;
  vaultTaglineQuestion: string;
  namingQuestion: string;
  namingBranded: (vault: string) => string;
  namingGeneric: string;
  profileQuestion: string;
  profileCore: string;
  profileCoreHint: string;
  profileFull: string;
  profileFullHint: string;

  adminSection: string;
  adminNameQuestion: string;
  adminRoleQuestion: string;
  adminRoleHint: string;
  adminAliasesQuestion: string;
  adminAliasesHint: string;

  detailQuestion: string;
  detailHint: string;
  projectSection: (name: string) => string;
  summaryQuestion: (name: string) => string;
  parentQuestion: (name: string) => string;
  parentNone: string;
  groupQuestion: (name: string) => string;
  groupNone: string;
  groupNew: string;
  groupNameQuestion: string;
  specializedQuestion: (name: string) => string;
  triggersQuestion: (name: string) => string;
  triggersHint: string;

  targetQuestion: string;
  targetHint: string;
  gitQuestion: string;
  overwriteWarning: (path: string) => string;
  confirmQuestion: (files: number, path: string) => string;

  generating: string;
  validating: string;
  doctorPassed: (files: number, links: number) => string;
  doctorFailed: (errors: number) => string;

  cancelled: string;
  summaryTitle: string;
  nextSteps: (path: string) => string;
  required: string;
}

const en: Messages = {
  introTitle: "Vulcanus",
  introBody: "Build an AI-readable second brain for you and your AI agents.",

  localeQuestion: "Language / Dil",
  localeTr: "Türkçe",
  localeEn: "English",

  importQuestion: "Import an existing AI history to seed your project tree?",
  importHint: "Nothing is copied into the vault — only project names you confirm.",
  importNone: "No, I'll define projects myself",
  importNoneHint: "Skip straight to the questions",
  importCustom: "Other path…",
  importCustomHint: "Point at an export folder yourself",
  importPathQuestion: "Path to the export",
  importSourceQuestion: "Which format is it?",
  detecting: "Looking for AI exports and local sessions",
  detected: (count) => `${count} source(s) found`,
  noSourcesFound: "No exports found automatically. You can still pass a path yourself.",
  reading: "Reading conversations",
  readDone: (conversations, candidates) =>
    `${conversations} conversations read, ${candidates} project candidates found`,
  readFailed: (message) => `Could not read the export: ${message}`,

  candidatesTitle: "Project candidates",
  candidatesHint: "Space to toggle, enter to confirm. Unchecked names are discarded.",
  candidateLabel: (name, conversations, confidence) =>
    `${name} — ${conversations} conversations, ${confidence} confidence`,
  manualProjectsQuestion: "Any other projects to add? (comma separated)",
  manualProjectsHint: "Leave empty to skip",
  projectListQuestion: "Final project list — edit names, add, or remove",
  projectListHint: "Comma separated. Names become folder and note names.",
  noProjects: "No projects selected; the vault will start with its system layer only.",

  vaultSection: "Vault",
  vaultNameQuestion: "Vault name",
  vaultNameHint: "Short, memorable — it becomes the vault's identity",
  vaultFullNameQuestion: "What does the name stand for? (optional)",
  vaultTaglineQuestion: "One-line description (optional)",
  namingQuestion: "How should system notes be named?",
  namingBranded: (vault) => `Branded — "${vault} Index.md", "${vault} Recall Map.md"`,
  namingGeneric: 'Generic — "Index.md", "Recall Map.md"',
  profileQuestion: "How deep should the system layer be?",
  profileCore: "Core",
  profileCoreHint: "Index, Recall Map, Admin Profile, Context, Rules, Update Format, Changelog, Import Log",
  profileFull: "Full",
  profileFullHint: "Core plus Brain OS Architecture, Operating Intuition, Neural Link Map, Confidence Model",

  adminSection: "Operator",
  adminNameQuestion: "Your name",
  adminRoleQuestion: "Your working identity (optional)",
  adminRoleHint: "e.g. Founder / Builder / Product Architect",
  adminAliasesQuestion: "Other words that mean you (optional, comma separated)",
  adminAliasesHint: "e.g. me, user",

  detailQuestion: "Answer detail questions for each project?",
  detailHint: "Summary, hierarchy, grouping, specialized notes, recall triggers",
  projectSection: (name) => `Project — ${name}`,
  summaryQuestion: (name) => `One-line definition of ${name}`,
  parentQuestion: (name) => `Does ${name} belong under another project?`,
  parentNone: "No — top level",
  groupQuestion: (name) => `Navigation group for ${name}?`,
  groupNone: "None",
  groupNew: "New group…",
  groupNameQuestion: "Group name",
  specializedQuestion: (name) => `Specialized notes for ${name}`,
  triggersQuestion: (name) => `Recall trigger words for ${name} (comma separated)`,
  triggersHint: "Words that should route an agent to this project",

  targetQuestion: "Where should the vault be created?",
  targetHint: "Relative or absolute path",
  gitQuestion: "Initialize a Git repository?",
  overwriteWarning: (path) => `${path} already exists and is not empty.`,
  confirmQuestion: (files, path) => `Create ${files} files in ${path}?`,

  generating: "Generating vault",
  validating: "Validating structure",
  doctorPassed: (files, links) => `${files} notes and ${links} links validated`,
  doctorFailed: (errors) => `${errors} problem(s) found`,

  cancelled: "Cancelled. Nothing was written.",
  summaryTitle: "Vault ready",
  nextSteps: (path) =>
    [
      `cd ${path}`,
      "vulcanus agents        # make your AI tools use this vault everywhere",
      "vulcanus doctor        # validate the structure",
      'vulcanus sync "topic"  # commit and push',
      "",
      "Read USING-WITH-AI.md first — it is the part that makes the vault pay off.",
    ].join("\n"),
  required: "This field is required",
};

const tr: Messages = {
  introTitle: "Vulcanus",
  introBody: "Kendin ve yapay zekâ ajanların için okunabilir bir ikinci beyin kur.",

  localeQuestion: "Dil / Language",
  localeTr: "Türkçe",
  localeEn: "English",

  importQuestion: "Proje ağacını çıkarmak için mevcut bir yapay zekâ geçmişini içe aktaralım mı?",
  importHint: "Vault'a hiçbir konuşma kopyalanmaz — yalnızca onayladığın proje isimleri kullanılır.",
  importNone: "Hayır, projeleri kendim tanımlayayım",
  importNoneHint: "Doğrudan sorulara geç",
  importCustom: "Başka bir yol…",
  importCustomHint: "Export klasörünü kendin göster",
  importPathQuestion: "Export yolu",
  importSourceQuestion: "Hangi formatta?",
  detecting: "Yapay zekâ export'ları ve yerel oturumlar aranıyor",
  detected: (count) => `${count} kaynak bulundu`,
  noSourcesFound: "Otomatik olarak export bulunamadı. Yine de bir yol verebilirsin.",
  reading: "Konuşmalar okunuyor",
  readDone: (conversations, candidates) =>
    `${conversations} konuşma okundu, ${candidates} proje adayı çıkarıldı`,
  readFailed: (message) => `Export okunamadı: ${message}`,

  candidatesTitle: "Proje adayları",
  candidatesHint: "Seçmek için boşluk, onaylamak için enter. İşaretlenmeyenler atılır.",
  candidateLabel: (name, conversations, confidence) =>
    `${name} — ${conversations} konuşma, ${confidence} güven`,
  manualProjectsQuestion: "Eklemek istediğin başka proje var mı? (virgülle ayır)",
  manualProjectsHint: "Boş bırakabilirsin",
  projectListQuestion: "Son proje listesi — isimleri düzelt, ekle ya da çıkar",
  projectListHint: "Virgülle ayır. İsimler klasör ve not adı olacak.",
  noProjects: "Proje seçilmedi; vault yalnızca sistem katmanıyla başlayacak.",

  vaultSection: "Vault",
  vaultNameQuestion: "Vault adı",
  vaultNameHint: "Kısa ve akılda kalıcı — vault'un kimliği olacak",
  vaultFullNameQuestion: "İsmin açılımı nedir? (opsiyonel)",
  vaultTaglineQuestion: "Tek cümlelik tanım (opsiyonel)",
  namingQuestion: "Sistem notları nasıl isimlendirilsin?",
  namingBranded: (vault) => `Markalı — "${vault} Index.md", "${vault} Recall Map.md"`,
  namingGeneric: 'Jenerik — "Index.md", "Recall Map.md"',
  profileQuestion: "Sistem katmanı ne kadar derin olsun?",
  profileCore: "Çekirdek",
  profileCoreHint: "Index, Recall Map, Admin Profile, Context, Rules, Update Format, Changelog, Import Log",
  profileFull: "Tam",
  profileFullHint: "Çekirdek + Brain OS Architecture, Operating Intuition, Neural Link Map, Confidence Model",

  adminSection: "Yönetici",
  adminNameQuestion: "Adın",
  adminRoleQuestion: "Çalışma kimliğin (opsiyonel)",
  adminRoleHint: "örn. Founder / Builder / Product Architect",
  adminAliasesQuestion: "Seni ifade eden diğer kelimeler (opsiyonel, virgülle ayır)",
  adminAliasesHint: "örn. ben, user",

  detailQuestion: "Her proje için detay sorularını soralım mı?",
  detailHint: "Tanım, hiyerarşi, gruplama, özel notlar, recall trigger'ları",
  projectSection: (name) => `Proje — ${name}`,
  summaryQuestion: (name) => `${name} tek cümleyle nedir?`,
  parentQuestion: (name) => `${name} başka bir projenin altında mı?`,
  parentNone: "Hayır — üst seviye",
  groupQuestion: (name) => `${name} için navigasyon grubu?`,
  groupNone: "Yok",
  groupNew: "Yeni grup…",
  groupNameQuestion: "Grup adı",
  specializedQuestion: (name) => `${name} için özel notlar`,
  triggersQuestion: (name) => `${name} için recall trigger kelimeleri (virgülle ayır)`,
  triggersHint: "Bir ajanı bu projeye yönlendirmesi gereken kelimeler",

  targetQuestion: "Vault nereye kurulsun?",
  targetHint: "Göreli ya da mutlak yol",
  gitQuestion: "Git deposu başlatılsın mı?",
  overwriteWarning: (path) => `${path} zaten var ve boş değil.`,
  confirmQuestion: (files, path) => `${path} içine ${files} dosya oluşturulsun mu?`,

  generating: "Vault oluşturuluyor",
  validating: "Yapı doğrulanıyor",
  doctorPassed: (files, links) => `${files} not ve ${links} bağlantı doğrulandı`,
  doctorFailed: (errors) => `${errors} sorun bulundu`,

  cancelled: "İptal edildi. Hiçbir dosya yazılmadı.",
  summaryTitle: "Vault hazır",
  nextSteps: (path) =>
    [
      `cd ${path}`,
      "vulcanus agents        # yapay zekâ araçlarına bu vault'u zorunlu kıl",
      "vulcanus doctor        # yapıyı doğrula",
      'vulcanus sync "konu"   # commit ve push',
      "",
      "Önce USING-WITH-AI.md dosyasını oku — vault'u değerli kılan kısım orada.",
    ].join("\n"),
  required: "Bu alan zorunlu",
};

export const MESSAGES: Record<Locale, Messages> = { tr, en };

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}
