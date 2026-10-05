/**
 * Phrases that mark a sentence as a decision, a standing rule, or a
 * correction, in every language the CLI ships.
 *
 * All locales are matched regardless of the vault's language: people switch
 * languages mid-conversation, and an English vault kept by a Turkish speaker
 * holds Turkish decisions. Patterns are matched against a lower-cased,
 * whitespace-collapsed sentence.
 *
 * Weights: 3 is an unambiguous statement ("we decided", "from now on"), 2 is a
 * strong but common construction, 1 is a word that is often a rule ("never",
 * "always") and just as often noise. A weight-1 sentence only surfaces when it
 * repeats across conversations.
 */

export type CueKind = "decision" | "rule" | "correction";

export interface Cue {
  kind: CueKind;
  weight: 1 | 2 | 3;
  pattern: RegExp;
}

const cue = (kind: CueKind, weight: Cue["weight"], source: string): Cue => ({
  kind,
  weight,
  pattern: new RegExp(source, "u"),
});

// `\b` does not understand non-ASCII letters, so word edges are spelled out.
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

export const CUES: Cue[] = [
  // --- English ---------------------------------------------------------------
  cue("decision", 3, `${B}(we|i) (have )?decided${E}`),
  cue("decision", 3, `${B}(final|the) decision( is|:)`),
  cue("decision", 3, `${B}(let'?s|we'?ll|we will|we'?re going to) go with${E}`),
  cue("decision", 3, `${B}we('?re| are) going with${E}`),
  cue("decision", 2, `${B}(we|i) (settled|agreed) on${E}`),
  cue("decision", 2, `${B}we (agreed|chose|picked)${E}`),
  cue("decision", 2, `${B}(we'?ll|we will) use${E}`),
  cue("rule", 3, `${B}(from now on|going forward|from here on)${E}`),
  cue("rule", 2, `${B}(must not|must never|should never)${E}`),
  cue("rule", 1, `${B}(never|always)${E}`),
  cue("rule", 1, `${B}(do not|don'?t)${E}`),
  cue("correction", 2, `${B}(actually|correction:?|to correct)${E}`),
  cue("correction", 2, `^no,`),

  // --- Turkish ---------------------------------------------------------------
  cue("decision", 3, `${B}karar (verdik|verdim|verildi|aldık|aldım)${E}`),
  cue("decision", 3, `${B}(nihai|son) karar${E}`),
  // "ile" is often a suffix: "modelle gidiyoruz", "Stripe'la devam ediyoruz".
  cue(
    "decision",
    3,
    `(?:${B}ile|\\p{L}(?:y?le|y?la)) (gidiyoruz|gideceğiz|devam ediyoruz|devam edeceğiz)${E}`,
  ),
  cue("decision", 2, `${B}(kullanacağız|seçtik|anlaştık)${E}`),
  cue("rule", 3, `${B}(bundan (sonra|böyle)|artık hep)${E}`),
  cue("rule", 2, `${B}(asla|hiçbir zaman|kesinlikle)${E}`),
  cue("rule", 1, `${B}(her zaman|daima)${E}`),
  cue("correction", 2, `${B}(aslında|düzeltme|yanlış (oldu|yazmışım|anlaşıldı))${E}`),
  cue("correction", 2, `^hayır,`),

  // --- German ----------------------------------------------------------------
  cue("decision", 3, `${B}(wir haben|ich habe) (uns )?(entschieden|beschlossen)${E}`),
  cue("decision", 3, `${B}(die )?entscheidung (ist|lautet|steht)${E}`),
  cue("decision", 2, `${B}wir (nehmen|gehen mit|bleiben bei|verwenden)${E}`),
  cue("decision", 2, `${B}festgelegt${E}`),
  cue("rule", 3, `${B}(ab jetzt|ab sofort|künftig|von nun an)${E}`),
  cue("rule", 2, `${B}(niemals|auf keinen fall)${E}`),
  cue("rule", 1, `${B}(immer|nie)${E}`),
  cue("correction", 2, `${B}(eigentlich|korrektur:?)${E}`),
  cue("correction", 2, `^nein,`),

  // --- Spanish ---------------------------------------------------------------
  cue("decision", 3, `${B}(hemos decidido|he decidido|decidimos)${E}`),
  cue("decision", 3, `${B}la decisión (es|final)${E}`),
  cue("decision", 2, `${B}(vamos con|nos quedamos con|usaremos|elegimos)${E}`),
  cue("rule", 3, `${B}(a partir de ahora|de ahora en adelante|en adelante)${E}`),
  cue("rule", 2, `${B}(jamás|bajo ningún concepto)${E}`),
  cue("rule", 1, `${B}(nunca|siempre)${E}`),
  cue("correction", 2, `${B}(en realidad|corrección:?)${E}`),
];

export interface CueMatch {
  /** Decision or rule; a correction alone does not make a candidate. */
  kind: "decision" | "rule";
  weight: number;
  /** The sentence also corrects something, so it may replace a decision. */
  correction: boolean;
}

/**
 * Classify one sentence. The strongest decision or rule cue wins; a correction
 * cue only marks the sentence, since "actually" on its own states nothing.
 */
export function classify(sentence: string, cues: Cue[] = CUES): CueMatch | null {
  const lower = sentence.toLowerCase();
  let best: { kind: "decision" | "rule"; weight: number } | null = null;
  let correction = false;
  for (const entry of cues) {
    if (!entry.pattern.test(lower)) continue;
    if (entry.kind === "correction") {
      correction = true;
    } else if (!best || entry.weight > best.weight) {
      best = { kind: entry.kind, weight: entry.weight };
    }
  }
  return best ? { ...best, correction } : null;
}
