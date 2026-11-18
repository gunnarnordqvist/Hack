// Input guard. This tool is for made-up examples only. Free text that looks like a personal identifier is never sent anywhere
// (not to the local backend, not to the terminology server). The check sits at the network boundary (txclient.js, app.js)
// and is deliberately blunt: a false alarm costs one retyped sentence, a miss could send a person's identity to a third party.

// Digits may be split by spaces, hyphens, dashes, dots or brackets; such a group with 9 or more digits is treated as an identity
// number or phone number. (Real SNOMED ids of 9+ digits are therefore refused in the search box too: acceptable for a demo.)
const DIGIT_GROUP = /\d(?:[\s+\-\u2010-\u2015\u2212.()]*\d)+/g;
const EMAIL = /[^\s@]+\s*(?:@|[(\[]\s*(?:at|snabel-a)\s*[)\]])\s*[^\s@]+\.[a-z]{2,}/i;

// Two capitalised words in a row inside a text ("Anna Svensson") look like a name; a street name with a number looks like an address.
// Symptom text is written in lower case, so this costs little. The very first word of the text may be capitalised.
const NAME = /(?<=\S\s)\p{Lu}\p{Ll}{3,}\s+\p{Lu}\p{Ll}{3,}/u;
const ADDRESS = /(?<![\p{L}])\p{L}{3,}(?:gatan|vägen|gränd|stigen|torget|allén|backen|street|road|avenue|lane|drive)\s+\d+/iu;

/** @returns {"personnummer"|"email"|"name"|"address"|null} what the text looks like, or null if nothing suspicious was found */
export function personalDataReason(text) {
  const t = String(text || "").normalize("NFKC");
  for (const m of t.match(DIGIT_GROUP) || []) if (m.replace(/\D/g, "").length >= 9) return "personnummer";
  if (EMAIL.test(t)) return "email";
  if (ADDRESS.test(t)) return "address";
  if (NAME.test(t)) return "name";
  return null;
}

export const PERSONAL_DATA_ERROR = "personal-data";
