import { createServerFn } from "@tanstack/react-start";

export type NcbiCitation = {
  text: string;
  url: string | null;
  pubmed: string | null;
};

export type NcbiProfile = {
  taxid: number;
  scientific: string;
  authority: string | null;
  basionym: string | null;
  synonyms: string[];
  equivalent: string[];
  misspellings: string[];
  commonNames: string[];
  includes: string[];
  inPart: string[];
  other: { label: string; name: string }[];
  citations: NcbiCitation[];
  akaTaxIds: number[];
  updated: string | null;
};

export const getNcbiProfile = createServerFn({ method: "GET" })
  .validator((input: number) => {
    const id = Number(input);
    if (!Number.isInteger(id) || id < 1 || id > 20_000_000) {
      throw new Error("Taxid inválido");
    }
    return id;
  })
  .handler(async ({ data }): Promise<NcbiProfile> => {
    const { fetchNcbiProfile } = await import("./ncbi-profile.server");
    return fetchNcbiProfile(data);
  });
