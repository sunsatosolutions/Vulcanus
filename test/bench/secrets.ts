/**
 * Detector benchmark: `npm run bench:secrets`.
 *
 * Set 1: 100 seeded secrets (built at run time). Set 2: 100 clean vault notes.
 * Reports the catch count with a per-class breakdown, the false positives and
 * the misses. Exits 1 below the bar. It never changes the detector.
 */
import { maskSecrets, scanText } from "../../src/secrets/detector.js";
import { buildCleanNotes, buildSeededSecrets } from "./secrets-sets.js";

const MIN_CAUGHT = 95;
const MAX_FALSE_POSITIVES = 2;

const secrets = buildSeededSecrets();
const notes = buildCleanNotes();

const byClass = new Map<string, { total: number; caught: number }>();
const missed: string[] = [];
const wrongKind: string[] = [];
let caught = 0;

for (const s of secrets) {
  const { text, findings } = maskSecrets(s.text, s.id);
  // Caught = the value is gone from the masked text. A kind mismatch is reported apart.
  const ok = findings.length > 0 && !text.includes(s.value);
  const stat = byClass.get(s.cls) ?? { total: 0, caught: 0 };
  stat.total += 1;
  if (ok) {
    stat.caught += 1;
    caught += 1;
    if (!findings.some((f) => f.kind === s.expect)) {
      wrongKind.push(
        `${s.id} ${s.cls}/${s.variant}: beklenen ${s.expect}, bulunan ${findings.map((f) => f.kind).join(",")}`,
      );
    }
  } else {
    // The line shape with the value replaced; the value itself is not printed.
    const shape = s.text.split(s.value).join("<DEĞER>").split("\n")[0].slice(0, 90);
    missed.push(`${s.id} ${s.cls}/${s.variant} (beklenen ${s.expect}): ${shape}`);
  }
  byClass.set(s.cls, stat);
}

const falsePositives: string[] = [];
const fpNotes = new Set<string>();
for (const note of notes) {
  const lines = note.text.split("\n");
  for (const f of scanText(note.text, note.id)) {
    fpNotes.add(note.id);
    falsePositives.push(`${note.id}:${f.line} ${f.kind}: ${lines[f.line - 1].slice(0, 90)}`);
  }
}

const out: string[] = [];
out.push(`Küme 1: ${secrets.length} tohumlanmış sır`);
out.push(`Yakalanan: ${caught}/${secrets.length} (çıta ≥ ${MIN_CAUGHT})`);
out.push("Sınıf kırılımı:");
for (const [cls, s] of byClass) out.push(`  ${cls.padEnd(13)} ${s.caught}/${s.total}`);
out.push(`Kaçan: ${missed.length}`);
for (const m of missed) out.push(`  ${m}`);
if (wrongKind.length) {
  out.push(`Yakalandı ama başka sınıfla: ${wrongKind.length}`);
  for (const w of wrongKind) out.push(`  ${w}`);
}
out.push("");
out.push(`Küme 2: ${notes.length} temiz not`);
out.push(
  `Yanlış pozitif: ${fpNotes.size}/${notes.length} not, ${falsePositives.length} bulgu (çıta ≤ ${MAX_FALSE_POSITIVES})`,
);
for (const f of falsePositives) out.push(`  ${f}`);

const pass = caught >= MIN_CAUGHT && fpNotes.size <= MAX_FALSE_POSITIVES;
out.push("");
out.push(pass ? "SONUÇ: çıta tuttu" : "SONUÇ: çıta tutmadı");
process.stdout.write(`${out.join("\n")}\n`);
process.exit(pass ? 0 : 1);
