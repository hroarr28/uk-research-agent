/**
 * The local eval asks the same model that wrote the answer to grade it.
 * That judge is weaker than a separate frontier model: it shares the answer's
 * blind spots, and a smaller Gemma tag is weaker still. Deterministic tool,
 * fact, and number checks are the reliable signal. The judge score is still
 * recorded, and a pass still requires score >= 4 and supported = true, so a
 * weak judge can change the pass rate.
 */
export const LOCAL_JUDGE_NOTE =
  "The judge is the same local model that wrote the answer. A local judge is weaker than a separate frontier model, and a smaller Gemma tag is weaker still. Deterministic tool, fact, and number checks are the reliable signal; the judge score is still part of the pass rule.";
