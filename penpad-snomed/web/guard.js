// Input guard. This tool is for made-up examples only. Free text that looks like a personal identifier is never sent anywhere
// (not to the local backend, not to the terminology server). The check sits at the network boundary (txclient.js, app.js)
// and is deliberately blunt: a false alarm costs one retyped sentence, a miss could send a person's identity to a third party.

// Digits may be split by spaces, hyphens, dashes, dots or brackets; such a group with 9 or more digits is treated as an identity
// number or phone number. (Real SNOMED ids of 9+ digits are therefore refused in the search box too: acceptable for a demo.)
const DIGIT_GROUP = /\d(?:[\s+\-\u2010-\u2015\u2212.()]*\d)+/g;
const EMAIL = /[^\s@]+\s*(?:@|[(\[]\s*(?:at|snabel-a)\s*[)\]])\s*[^\s@]+\.[a-z]{2,}/i;

/** @returns {"personnummer"|"email"|null} what the text looks like, or null if nothing suspicious was found */
export function personalDataReason(text) {
  const t = String(text || "").normalize("NFKC");
  for (const m of t.match(DIGIT_GROUP) || []) if (m.replace(/\D/g, "").length >= 9) return "personnummer";
  if (EMAIL.test(t)) return "email";
  return null;
}

export const PERSONAL_DATA_ERROR = "personal-data";
