import type { NcbiCitation, NcbiProfile } from "./ncbi-profile";

const cache = new Map<number, NcbiProfile>();

const RANK_MARK = /^(var\.|subsp\.|ssp\.|f\.|subg\.|subgen\.|sect\.|ser\.|nothosubsp\.)/;

export async function fetchNcbiProfile(taxid: number): Promise<NcbiProfile> {
  const cached = cache.get(taxid);
  if (cached) return cached;
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=taxonomy&id=${taxid}&retmode=xml`;
  const response = await fetch(url, {
    headers: { "User-Agent": "herbario-catalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`NCBI ${response.status}`);
  const profile = parseTaxonXml(await response.text(), taxid);
  cache.set(taxid, profile);
  return profile;
}

function parseTaxonXml(xml: string, taxid: number): NcbiProfile {
  const other = inner(xml, "OtherNames") ?? "";
  const synonyms = unique([...tags(other, "Synonym"), ...tags(other, "GenbankSynonym")]);
  const equivalent = unique(tags(other, "EquivalentName"));
  const misspellings = unique([...tags(other, "Misspelling"), ...namesOfClass(other, "misspelling")]);
  const commonNames = unique([...tags(other, "GenbankCommonName"), ...tags(other, "CommonName")]);
  const includes = unique(tags(other, "Includes"));
  const inPart = unique(tags(other, "Inpart"));
  const authorities = namesOfClass(other, "authority");
  const otherNames = namesByClass(other).filter(
    (item) => !["authority", "misspelling", "synonym"].includes(item.label),
  );

  const scientific = firstTag(xml, "ScientificName") ?? "";
  const accepted = authorities.find((raw) => isAcceptedAuthority(raw, scientific)) ?? null;
  const basionym = accepted ? findBasionym(scientific, accepted, synonyms, authorities) : null;
  const shownSynonyms = synonyms
    .filter((name) => withAuthor(name, authorities) !== basionym)
    .map((name) => withAuthor(name, authorities));

  return {
    taxid,
    scientific,
    authority: accepted,
    basionym,
    synonyms: shownSynonyms,
    equivalent,
    misspellings,
    commonNames,
    includes,
    inPart,
    other: [
      ...labeled(tags(other, "Anamorph"), "Anamorfo"),
      ...labeled(tags(other, "Teleomorph"), "Teleomorfo"),
      ...labeled(tags(other, "Misnomer"), "Nome mal aplicado"),
      ...labeled(tags(other, "Acronym"), "Sigla"),
      ...otherNames.map((item) => ({ label: item.label, name: item.name })),
    ],
    citations: parseCitations(inner(xml, "Citations") ?? ""),
    akaTaxIds: tags(inner(xml, "AkaTaxIds") ?? "", "TaxId")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value !== taxid),
    updated: formatDate(firstTag(xml, "UpdateDate")),
  };
}

function findBasionym(
  scientific: string,
  accepted: string,
  synonyms: string[],
  authorities: string[],
): string | null {
  const author = accepted.slice(scientific.length).trim();
  const paren = author.match(/^\(([^)]+)\)/);
  if (!paren) return null;
  const wanted = authorKey(paren[1]);
  if (!wanted) return null;
  const hits = synonyms.filter((name) => {
    if (name === scientific) return false;
    const full = authorities.find((raw) => raw === name || raw.startsWith(`${name} `));
    if (!full) return false;
    const synonymAuthor = full.slice(name.length).trim();
    if (synonymAuthor.startsWith("(")) return false;
    return authorKey(synonymAuthor) === wanted;
  });
  if (hits.length !== 1) return null;
  return withAuthor(hits[0], authorities);
}

function isAcceptedAuthority(raw: string, scientific: string): boolean {
  if (raw === scientific) return true;
  if (!scientific || !raw.startsWith(`${scientific} `)) return false;
  return !RANK_MARK.test(raw.slice(scientific.length + 1));
}

function withAuthor(name: string, authorities: string[]): string {
  const full = authorities.find((raw) => raw === name || raw.startsWith(`${name} `));
  return full ?? name;
}

function authorKey(author: string): string {
  return author
    .replace(/,?\s*\d{4}.*$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function namesOfClass(xml: string, className: string): string[] {
  return namesByClass(xml)
    .filter((item) => item.label === className)
    .map((item) => item.name);
}

function namesByClass(xml: string): { label: string; name: string }[] {
  return [...xml.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].flatMap((match) => {
    const label = firstTag(match[1], "ClassCDE");
    const name = firstTag(match[1], "DispName");
    return label && name ? [{ label, name }] : [];
  });
}

function parseCitations(xml: string): NcbiCitation[] {
  return [...xml.matchAll(/<Citation>([\s\S]*?)<\/Citation>/g)].flatMap((match) => {
    const text = firstTag(match[1], "CitText") ?? firstTag(match[1], "CitKey");
    if (!text) return [];
    const pubmed = firstTag(match[1], "CitPubmedId");
    return [
      {
        text,
        url: firstTag(match[1], "CitUrl"),
        pubmed: pubmed && /^\d+$/.test(pubmed) ? pubmed : null,
      },
    ];
  });
}

function labeled(names: string[], label: string): { label: string; name: string }[] {
  return names.map((name) => ({ label, name }));
}

function formatDate(value: string | null): string | null {
  const match = value?.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function inner(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}

function firstTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decode(match[1].trim()) : null;
}

function tags(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))]
    .map((match) => decode(match[1].trim()))
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&");
}
