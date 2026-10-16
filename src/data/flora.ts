export type Rank =
  | "dominio"
  | "reino"
  | "divisao"
  | "classe"
  | "ordem"
  | "familia"
  | "genero"
  | "especie"
  | "subespecie";

export type Morphology = { label: string; value: string };

export type Taxon = {
  id: string;
  rank: Rank;
  scientific: string;
  authority?: string;
  vernacular?: string;
  parentId: string | null;
  summary?: string;
  ncbiId?: number;
  image?: string;
  sheet?: string;
  habit?: string;
  habitat?: string;
  distribution?: string;
  elevation?: string;
  phenology?: string;
  status?: string;
  diagnosis?: string[];
  morphology?: Morphology[];
  notes?: string;
  wfoId?: string;
  relatedIds?: string[];
};

export const RANK_LABEL: Record<Rank, string> = {
  dominio: "Domínio",
  reino: "Reino",
  divisao: "Divisão",
  classe: "Classe",
  ordem: "Ordem",
  familia: "Família",
  genero: "Gênero",
  especie: "Espécie",
  subespecie: "Subespécie",
};

export const RANK_ORDER: Rank[] = [
  "dominio",
  "reino",
  "divisao",
  "classe",
  "ordem",
  "familia",
  "genero",
  "especie",
  "subespecie",
];

export const GENUS_COUNT = 19994;
export const SPECIES_COUNT = 428620;
export const SUBSPECIES_COUNT = 29544;

const collator = new Intl.Collator("pt", { sensitivity: "base" });

function byScientificName(a: { scientific: string }, b: { scientific: string }): number {
  return collator.compare(a.scientific, b.scientific);
}

type HigherRow = [string, Rank, string, string | null, number | null, string, string?];

let TAXA: Taxon[] = [];
let byIdMap = new Map<string, Taxon>();
let childrenMap = new Map<string, Taxon[]>();
let byScientific = new Map<string, Taxon>();
let orderedTree: Taxon[] = [];
const byRank = new Map<Rank, Taxon[]>();
const higherName = new Map<string, string>();
let higherReady = false;
let higherPromise: Promise<void> | null = null;

export function loadHigherTaxa(): Promise<void> {
  if (higherReady) return Promise.resolve();
  if (!higherPromise) higherPromise = fetchHigher();
  return higherPromise;
}

async function fetchHigher(): Promise<void> {
  const response = await fetch("/higher.json");
  if (!response.ok) throw new Error(String(response.status));
  const data = (await response.json()) as { rows: HigherRow[] };
  installHigher(data.rows);
  higherReady = true;
}

function installHigher(rows: HigherRow[]) {
  const rankSet = new Set<string>(RANK_ORDER);
  TAXA = rows.map((row) => {
    const [id, rank, scientific, parentId, ncbiId, summary] = row;
    if (!rankSet.has(rank)) throw new Error(`Categoria desconhecida: ${rank}`);
    const taxon: Taxon = { id, rank, scientific, parentId, summary };
    if (ncbiId) taxon.ncbiId = ncbiId;
    if (row[6]) taxon.wfoId = row[6];
    return taxon;
  });
  byIdMap = new Map(TAXA.map((taxon) => [taxon.id, taxon]));
  childrenMap = new Map();
  byScientific = new Map();
  byRank.clear();
  higherName.clear();
  for (const taxon of TAXA) {
    if (taxon.parentId) {
      const list = childrenMap.get(taxon.parentId);
      if (list) list.push(taxon);
      else childrenMap.set(taxon.parentId, [taxon]);
    }
    if (!byScientific.has(taxon.scientific)) byScientific.set(taxon.scientific, taxon);
    const bucket = byRank.get(taxon.rank);
    if (bucket) bucket.push(taxon);
    else byRank.set(taxon.rank, [taxon]);
    higherName.set(taxon.id, taxon.scientific.toLowerCase());
  }
  for (const list of childrenMap.values()) list.sort(byScientificName);
  for (const list of byRank.values()) list.sort(byScientificName);
  orderedTree = TAXA.filter((taxon) => taxon.parentId === null).flatMap((root) => walkHigher(root.id));
}

function walkHigher(id: string): Taxon[] {
  const node = byIdMap.get(id);
  if (!node) return [];
  const out = [node];
  for (const child of childrenMap.get(id) ?? []) {
    for (const item of walkHigher(child.id)) out.push(item);
  }
  return out;
}

export function taxaOfRank(rank: Rank): Taxon[] {
  return byRank.get(rank) ?? [];
}

export function searchHigher(needle: string, limit = 40): Taxon[] {
  if (!needle || limit <= 0) return [];
  const exact: Taxon[] = [];
  const prefix: Taxon[] = [];
  const contains: Taxon[] = [];
  const numeric = /^\d+$/.test(needle);
  for (const taxon of TAXA) {
    if (prefix.length >= limit && contains.length >= limit && exact.length >= limit) break;
    const name = higherName.get(taxon.id) ?? "";
    if (name === needle) {
      if (exact.length < limit) exact.push(taxon);
    } else if (prefix.length < limit && name.startsWith(needle)) {
      prefix.push(taxon);
    } else if (
      contains.length < limit &&
      (name.includes(needle) || (numeric && taxon.ncbiId !== undefined && String(taxon.ncbiId).includes(needle)))
    ) {
      contains.push(taxon);
    }
  }
  return exact.concat(prefix, contains).slice(0, limit);
}

type SpeciesRow = [number, string, string];
type SubspeciesRow = [number, string, number];
type WfoRow = [string, string, string, string];

let speciesRows: SpeciesRow[] = [];
let subspeciesRows: SubspeciesRow[] = [];
let speciesNorm: string[] = [];
let subspeciesNorm: string[] = [];
const speciesByGenus = new Map<string, SpeciesRow[]>();
const subspeciesBySpecies = new Map<number, SubspeciesRow[]>();
const speciesByNcbi = new Map<number, SpeciesRow>();
const subspeciesByNcbi = new Map<number, SubspeciesRow>();
const speciesByName = new Map<string, SpeciesRow>();
const subspeciesByName = new Map<string, SubspeciesRow>();
const lowerCache = new Map<string, Taxon>();
const childView = new Map<string, { n: number; taxa: Taxon[] }>();
const wfoSpeciesByGenus = new Map<string, WfoRow[]>();
const wfoSubByParent = new Map<string, WfoRow[]>();
const wfoSpeciesById = new Map<string, WfoRow>();
const wfoSubById = new Map<string, WfoRow>();
const wfoSpeciesByName = new Map<string, WfoRow>();
const wfoSubByName = new Map<string, WfoRow>();
let wfoSpecies: WfoRow[] = [];
let wfoSubspecies: WfoRow[] = [];
let wfoSpeciesNorm: string[] = [];
let wfoSubspeciesNorm: string[] = [];
const wfoSpeciesBuckets = new Map<string, number[]>();
const wfoSubspeciesBuckets = new Map<string, number[]>();

function taxonFromWfo(row: WfoRow, rank: "especie" | "subespecie"): Taxon {
  const cached = lowerCache.get(row[0]);
  if (cached) return cached;
  const taxon: Taxon = {
    id: row[0],
    rank,
    scientific: row[1],
    parentId: row[2],
    wfoId: row[0],
    summary:
      rank === "especie"
        ? "Espécie aceita no WFO Plant List, ausente no NCBI Taxonomy."
        : "Subespécie aceita no WFO Plant List, ausente no NCBI Taxonomy.",
  };
  if (row[3]) taxon.notes = row[3];
  lowerCache.set(row[0], taxon);
  return taxon;
}

export async function indexWfo(species: WfoRow[], subspecies: WfoRow[]) {
  wfoSpecies = species;
  wfoSubspecies = subspecies;
  wfoSpeciesNorm = new Array(species.length);
  wfoSubspeciesNorm = new Array(subspecies.length);
  wfoSpeciesByGenus.clear();
  wfoSubByParent.clear();
  wfoSpeciesById.clear();
  wfoSubById.clear();
  wfoSpeciesByName.clear();
  wfoSubByName.clear();
  wfoSpeciesBuckets.clear();
  wfoSubspeciesBuckets.clear();
  childView.clear();
  const chunk = 20000;
  for (let index = 0; index < species.length; index += 1) {
    const row = species[index];
    const name = row[1].toLowerCase();
    wfoSpeciesNorm[index] = name;
    wfoSpeciesById.set(row[0], row);
    if (!wfoSpeciesByName.has(row[1])) wfoSpeciesByName.set(row[1], row);
    const list = wfoSpeciesByGenus.get(row[2]);
    if (list) list.push(row);
    else wfoSpeciesByGenus.set(row[2], [row]);
    rememberBucket(wfoSpeciesBuckets, name, index);
    if (index % chunk === chunk - 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (let index = 0; index < subspecies.length; index += 1) {
    const row = subspecies[index];
    const name = row[1].toLowerCase();
    wfoSubspeciesNorm[index] = name;
    wfoSubById.set(row[0], row);
    if (!wfoSubByName.has(row[1])) wfoSubByName.set(row[1], row);
    const list = wfoSubByParent.get(row[2]);
    if (list) list.push(row);
    else wfoSubByParent.set(row[2], [row]);
    rememberBucket(wfoSubspeciesBuckets, name, index);
  }
}
const speciesBuckets = new Map<string, number[]>();
const subspeciesBuckets = new Map<string, number[]>();
let lowerPromise: Promise<void> | null = null;
let lowerIndexed = false;

function rememberBucket(buckets: Map<string, number[]>, name: string, index: number) {
  const keys: string[] = [];
  for (const word of name.split(" ")) {
    if (word.length < 2) continue;
    const key = word.slice(0, 2);
    if (keys.includes(key)) continue;
    keys.push(key);
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
  }
}

export function loadLowerTaxa(): Promise<void> {
  if (lowerIndexed) return Promise.resolve();
  if (!lowerPromise) {
    lowerPromise = fetch("/viridi-lower.json")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{
          species: SpeciesRow[];
          subspecies: SubspeciesRow[];
        }>;
      })
      .then((data) => indexLowerTaxa(data.species, data.subspecies))
      .then(() =>
        fetch("/wfo-added.json").then((response) => {
          if (!response.ok) return null;
          return response.json() as Promise<{ species: WfoRow[]; subspecies: WfoRow[] }>;
        }),
      )
      .then((added) => (added ? indexWfo(added.species, added.subspecies) : undefined))
      .then(() => {
        lowerIndexed = true;
      })
      .catch((error) => {
        lowerPromise = null;
        throw error;
      });
  }
  return lowerPromise;
}

export async function indexLowerTaxa(species: SpeciesRow[], subspecies: SubspeciesRow[]) {
  speciesRows = species;
  subspeciesRows = subspecies;
  speciesNorm = new Array(species.length);
  subspeciesNorm = new Array(subspecies.length);
  childView.clear();
  const chunk = 20000;
  for (let index = 0; index < species.length; index += 1) {
    const row = species[index];
    const name = row[1].toLowerCase();
    speciesNorm[index] = name;
    rememberBucket(speciesBuckets, name, index);
    if (!speciesByNcbi.has(row[0])) {
      const list = speciesByGenus.get(row[2]);
      if (list) list.push(row);
      else speciesByGenus.set(row[2], [row]);
      speciesByNcbi.set(row[0], row);
      if (!byScientific.has(row[1]) && !speciesByName.has(row[1])) speciesByName.set(row[1], row);
    }
    if (index % chunk === chunk - 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (let index = 0; index < subspecies.length; index += 1) {
    const row = subspecies[index];
    const name = row[1].toLowerCase();
    subspeciesNorm[index] = name;
    rememberBucket(subspeciesBuckets, name, index);
    if (!subspeciesByNcbi.has(row[0])) {
      const list = subspeciesBySpecies.get(row[2]);
      if (list) list.push(row);
      else subspeciesBySpecies.set(row[2], [row]);
      subspeciesByNcbi.set(row[0], row);
      if (!byScientific.has(row[1]) && !speciesByName.has(row[1]) && !subspeciesByName.has(row[1])) {
        subspeciesByName.set(row[1], row);
      }
    }
  }
}

function isSpeciesBinomial(name: string): boolean {
  return /^\p{Lu}[\p{L}'-]*\s+(?:×\s+)?\p{Ll}[\p{L}'-]*$/u.test(name);
}

function taxonFromSpecies(row: SpeciesRow): Taxon {
  const id = `s${row[0]}`;
  const cached = lowerCache.get(id);
  if (cached) return cached;
  const taxon: Taxon = {
    id,
    rank: "especie",
    scientific: row[1],
    parentId: row[2],
    ncbiId: row[0],
  };
  lowerCache.set(id, taxon);
  return taxon;
}

function taxonFromSubspecies(row: SubspeciesRow): Taxon {
  const id = `u${row[0]}`;
  const cached = lowerCache.get(id);
  if (cached) return cached;
  const taxon: Taxon = {
    id,
    rank: "subespecie",
    scientific: row[1],
    parentId: `s${row[2]}`,
    ncbiId: row[0],
  };
  lowerCache.set(id, taxon);
  return taxon;
}

function speciesNcbi(id: string): number | null {
  return /^s\d+$/.test(id) ? Number(id.slice(1)) : null;
}

function subspeciesNcbi(id: string): number | null {
  return /^u\d+$/.test(id) ? Number(id.slice(1)) : null;
}

export function taxonById(id: string): Taxon {
  const higher = byIdMap.get(id);
  if (higher) return higher;
  const cached = lowerCache.get(id);
  if (cached) return cached;
  const speciesId = speciesNcbi(id);
  if (speciesId !== null) {
    const row = speciesByNcbi.get(speciesId);
    if (row) return taxonFromSpecies(row);
  }
  const subspeciesId = subspeciesNcbi(id);
  if (subspeciesId !== null) {
    const row = subspeciesByNcbi.get(subspeciesId);
    if (row) return taxonFromSubspecies(row);
  }
  const wfoSpeciesRow = wfoSpeciesById.get(id);
  if (wfoSpeciesRow) return taxonFromWfo(wfoSpeciesRow, "especie");
  const wfoSubRow = wfoSubById.get(id);
  if (wfoSubRow) return taxonFromWfo(wfoSubRow, "subespecie");
  throw new Error(`Táxon desconhecido: ${id}`);
}

export function taxonByScientific(name: string): Taxon | undefined {
  const higher = byScientific.get(name);
  if (higher) return higher;
  const species = speciesByName.get(name);
  if (species) return taxonFromSpecies(species);
  const subspecies = subspeciesByName.get(name);
  if (subspecies) return taxonFromSubspecies(subspecies);
  const addedSpecies = wfoSpeciesByName.get(name);
  if (addedSpecies) return taxonFromWfo(addedSpecies, "especie");
  const addedSubspecies = wfoSubByName.get(name);
  if (addedSubspecies) return taxonFromWfo(addedSubspecies, "subespecie");
  return undefined;
}

export function childrenOf(id: string): Taxon[] {
  const higher = childrenMap.get(id) ?? [];
  const speciesId = speciesNcbi(id);
  if (speciesId !== null || id.startsWith("wfo-")) {
    const ncbiRows = speciesId !== null ? (subspeciesBySpecies.get(speciesId) ?? []) : [];
    const added = wfoSubByParent.get(id) ?? [];
    if (ncbiRows.length === 0 && added.length === 0) return higher;
    return cachedChildren(`sub:${id}:${higher.length}`, ncbiRows.length + added.length, () => {
      const taxa = ncbiRows.map(taxonFromSubspecies).concat(added.map((row) => taxonFromWfo(row, "subespecie")));
      return higher.length ? higher.concat(taxa) : taxa;
    });
  }
  const ncbiSpecies = (speciesByGenus.get(id) ?? []).filter((row) => isSpeciesBinomial(row[1]));
  const addedSpecies = (wfoSpeciesByGenus.get(id) ?? []).filter((row) => isSpeciesBinomial(row[1]));
  if (ncbiSpecies.length === 0 && addedSpecies.length === 0) return higher;
  return cachedChildren(`gen:${id}:${higher.length}`, ncbiSpecies.length + addedSpecies.length, () => {
    const taxa = ncbiSpecies.map(taxonFromSpecies).concat(addedSpecies.map((row) => taxonFromWfo(row, "especie")));
    return higher.length ? higher.concat(taxa) : taxa;
  });
}

function cachedChildren(key: string, n: number, build: () => Taxon[]): Taxon[] {
  const hit = childView.get(key);
  if (hit && hit.n === n) return hit.taxa;
  const taxa = build();
  taxa.sort(byScientificName);
  childView.set(key, { n, taxa });
  return taxa;
}

const loadedGenera = new Set<string>();

export function ensureGenusSpecies(genusId: string): Promise<void> {
  if (loadedGenera.has(genusId) || speciesByGenus.has(genusId)) {
    loadedGenera.add(genusId);
    return Promise.resolve();
  }
  return fetch(`/genera/${encodeURIComponent(genusId)}.json`)
    .then((response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{
        species: [number, string][];
        subspecies: [number, string, number][];
      }>;
    })
    .then((data) => {
      if (!data) {
        loadedGenera.add(genusId);
        return;
      }
      if (speciesByGenus.has(genusId)) {
        loadedGenera.add(genusId);
        return;
      }
      const species: SpeciesRow[] = (data?.species ?? []).map((row) => [row[0], row[1], genusId]);
      speciesByGenus.set(genusId, species);
      for (const row of species) {
        speciesByNcbi.set(row[0], row);
        if (!byScientific.has(row[1]) && !speciesByName.has(row[1])) speciesByName.set(row[1], row);
      }
      for (const row of data?.subspecies ?? []) {
        const list = subspeciesBySpecies.get(row[2]);
        if (list) list.push(row);
        else subspeciesBySpecies.set(row[2], [row]);
        subspeciesByNcbi.set(row[0], row);
        if (!byScientific.has(row[1]) && !speciesByName.has(row[1]) && !subspeciesByName.has(row[1])) {
          subspeciesByName.set(row[1], row);
        }
      }
      loadedGenera.add(genusId);
    });
}

export function genusIdOf(id: string): string | null {
  const taxon = taxonById(id);
  if (taxon.rank === "genero") return taxon.id;
  if (taxon.rank === "especie") return taxon.parentId;
  if (taxon.rank === "subespecie" && taxon.parentId) return taxonById(taxon.parentId).parentId;
  return null;
}

export function lineageOf(id: string): Taxon[] {
  const chain: Taxon[] = [];
  let current: Taxon | undefined = taxonById(id);
  while (current) {
    chain.push(current);
    current = current.parentId ? taxonById(current.parentId) : undefined;
  }
  return chain.reverse();
}

export function speciesCount(id: string): number {
  const taxon = taxonById(id);
  if (taxon.rank === "especie") return 1;
  return childrenOf(id).reduce((sum, child) => sum + speciesCount(child.id), 0);
}

export function treeOrder(): Taxon[] {
  return orderedTree;
}

export function searchLower(needle: string, limit = 40): Taxon[] {
  if (!needle || speciesRows.length === 0 || limit <= 0) return [];
  const exact: Taxon[] = [];
  const prefix: Taxon[] = [];
  const contains: Taxon[] = [];

  const scan = (
    rows: Array<SpeciesRow | SubspeciesRow | WfoRow>,
    norms: string[],
    buckets: Map<string, number[]>,
    make: (row: SpeciesRow | SubspeciesRow | WfoRow) => Taxon,
  ) => {
    const indexes = needle.length >= 2 ? buckets.get(needle.slice(0, 2)) : undefined;
    if (needle.length >= 2 && !indexes) return;
    const visit = (index: number) => {
      if (prefix.length >= limit && contains.length >= limit) return;
      const name = norms[index];
      const row = rows[index];
      if (name === needle) {
        if (exact.length < limit) exact.push(make(row));
      } else if (prefix.length < limit && name.startsWith(needle)) {
        prefix.push(make(row));
      } else if (
        contains.length < limit &&
        (name.includes(needle) || String(row[0]).includes(needle))
      ) {
        contains.push(make(row));
      }
    };
    if (indexes) {
      for (const index of indexes) {
        if (prefix.length >= limit && contains.length >= limit) break;
        visit(index);
      }
      return;
    }
    for (let index = 0; index < rows.length; index += 1) {
      if (prefix.length >= limit && contains.length >= limit) return;
      visit(index);
    }
  };

  scan(speciesRows, speciesNorm, speciesBuckets, (row) => taxonFromSpecies(row as SpeciesRow));
  scan(wfoSpecies, wfoSpeciesNorm, wfoSpeciesBuckets, (row) => taxonFromWfo(row as WfoRow, "especie"));
  return exact
    .concat(prefix, contains)
    .filter((taxon) => taxon.rank === "especie" && isSpeciesBinomial(taxon.scientific))
    .slice(0, limit);
}

export function isItalicRank(rank: Rank): boolean {
  return rank === "genero" || rank === "especie" || rank === "subespecie";
}
