import { createHash, timingSafeEqual } from "node:crypto";

/**
 * SCC-OMS data_digest (spec PDF pp. 16–18).
 *
 * Concatenate the raw logistics_interface plaintext and the MD5 special string,
 * MD5 that UTF-8 string, take the lowercase hex digest, then Base64-encode the
 * hex characters. Base64 is not applied to the raw MD5 bytes.
 *
 * The special string is supplied at runtime and is never logged here.
 */
export function dataDigest(plaintext: string, md5SpecialString: string): string {
  const hex = createHash("md5")
    .update(Buffer.from(`${plaintext}${md5SpecialString}`, "utf8"))
    .digest("hex");
  return Buffer.from(hex, "utf8").toString("base64");
}

export function secretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function digestMatches(
  plaintext: string,
  md5SpecialString: string,
  presented: string,
): boolean {
  const expected = dataDigest(plaintext, md5SpecialString);
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
