import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { NcbiRecord } from "@/components/ncbi-record";
import {
  GENUS_COUNT,
  RANK_LABEL,
  SPECIES_COUNT,
  SUBSPECIES_COUNT,
  childrenOf,
  ensureGenusSpecies,
  genusIdOf,
  isItalicRank,
  lineageOf,
  loadHigherTaxa,
  loadLowerTaxa,
  searchHigher,
  searchLower,
  taxaOfRank,
  taxonById,
  treeOrder,
  type Rank,
  type Taxon,
} from "@/data/flora";

type RankFilter = Rank | "tudo";

const FILTERS: { id: RankFilter; label: string }[] = [
  { id: "dominio", label: "Domínios" },
  { id: "reino", label: "Reinos" },
  { id: "divisao", label: "Divisões" },
  { id: "classe", label: "Classes" },
  { id: "ordem", label: "Ordens" },
  { id: "familia", label: "Famílias" },
  { id: "genero", label: "Gêneros" },
  { id: "especie", label: "Espécies" },
  { id: "subespecie", label: "Subespécies" },
  { id: "tudo", label: "Tudo" },
];

const INDENT: Record<Rank, string> = {
  dominio: "pl-2",
  reino: "pl-3",
  divisao: "pl-4",
  classe: "pl-5",
  ordem: "pl-6",
  familia: "pl-7",
  genero: "pl-8",
  especie: "pl-9",
  subespecie: "pl-10",
};

function normalize(value: string): string {
  return value.toLowerCase();
}

const SEARCH_LIMIT = 40;

function hitRank(taxon: Taxon, query: string): number {
  const name = normalize(taxon.scientific);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

function ScientificName({
  taxon,
  className = "",
  compact = false,
}: {
  taxon: Taxon;
  className?: string;
  compact?: boolean;
}) {
  const subspecies = taxon.scientific.split(/\s+(?:subsp\.|ssp\.)\s+/);
  if (subspecies.length === 2 && (taxon.rank === "subespecie" || taxon.scientific.includes(" subsp. ") || taxon.scientific.includes(" ssp. "))) {
    const epithet = subspecies[1];
    if (compact) {
      return (
        <span className={`font-display text-taxon ${className}`}>
          <span className="font-sans not-italic">subsp. </span>
          <span className="italic">{epithet}</span>
        </span>
      );
    }
    const chunks = taxon.scientific.split(/(\s+subsp\.\s+|\s+ssp\.\s+)/);
    return (
      <span className={`font-display text-taxon ${className}`}>
        {chunks.map((chunk, index) =>
          /^\s+(?:subsp\.|ssp\.)\s+$/.test(chunk) ? (
            <span key={index}>{chunk}</span>
          ) : (
            <span key={index} className="italic">
              {chunk}
            </span>
          ),
        )}
      </span>
    );
  }
  const italic = isItalicRank(taxon.rank);
  return (
    <span className={`${italic ? "font-display italic" : "font-display"} text-taxon ${className}`}>
      {taxon.scientific}
    </span>
  );
}

export function FloraCatalog() {
  const [selectedId, setSelectedId] = useState("rosa");
  const [rankFilter, setRankFilter] = useState<RankFilter>("genero");
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lowerReady, setLowerReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [speciesState, setSpeciesState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const needle = normalize(query.trim());
  const [searchNeedle, setSearchNeedle] = useState("");
  const ordered = useMemo(() => (catalogReady ? treeOrder() : []), [catalogReady]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchNeedle(needle), 120);
    return () => window.clearTimeout(timer);
  }, [needle]);

  useEffect(() => {
    let cancel = false;
    loadHigherTaxa()
      .then(() => {
        if (!cancel) setCatalogReady(true);
      })
      .catch(() => {
        if (!cancel) setCatalogError(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogReady) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      loadLowerTaxa()
        .then(() => {
          if (!cancel) setLowerReady(true);
        })
        .catch(() => {
          if (!cancel) setLowerReady(false);
        });
    }, 300);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [catalogReady]);

  useEffect(() => {
    if (!catalogReady) return;
    const genusId = genusIdOf(selectedId);
    if (!genusId) {
      setSpeciesState("ready");
      return;
    }
    let cancel = false;
    setSpeciesState("loading");
    ensureGenusSpecies(genusId)
      .then(() => {
        if (!cancel) setSpeciesState("ready");
      })
      .catch(() => {
        if (!cancel) setSpeciesState("error");
      });
    return () => {
      cancel = true;
    };
  }, [selectedId, catalogReady]);

  const visible = useMemo(() => {
    if (!catalogReady) return [];
    if (searchNeedle) {
      const hits = searchHigher(searchNeedle, SEARCH_LIMIT);
      if (lowerReady) {
        for (const taxon of searchLower(searchNeedle, SEARCH_LIMIT)) hits.push(taxon);
      }
      hits.sort((a, b) => hitRank(a, searchNeedle) - hitRank(b, searchNeedle));
      return hits.filter((taxon) => taxon.rank !== "subespecie");
    }
    if (rankFilter === "especie" || rankFilter === "subespecie") return [];
    if (rankFilter === "tudo") return ordered;
    return taxaOfRank(rankFilter);
  }, [catalogReady, ordered, rankFilter, searchNeedle, lowerReady]);
  const shown = searchNeedle ? visible.slice(0, SEARCH_LIMIT) : visible;
  const listRef = useRef<HTMLDivElement>(null);
  const [windowRange, setWindowRange] = useState({ start: 0, end: 48 });

  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
    setWindowRange({ start: 0, end: Math.min(shown.length, 48) });
  }, [rankFilter, searchNeedle, shown.length]);

  function onListScroll() {
    const scroller = listRef.current;
    if (!scroller) return;
    const row = 56;
    const start = Math.max(0, Math.floor(scroller.scrollTop / row) - 8);
    const end = Math.min(shown.length, start + Math.ceil(scroller.clientHeight / row) + 16);
    setWindowRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }

  const listStart = windowRange.start;
  const listEnd = Math.max(windowRange.end, Math.min(shown.length, 48));
  const listItems = shown.slice(listStart, listEnd);

  if (!catalogReady) {
    return (
      <div className="flex h-dvh flex-col bg-bg text-ink">
        <header className="shrink-0 border-b border-line bg-bg-elevated">
          <div className="flex items-end justify-between gap-4 px-4 py-4 md:px-6">
            <div>
              <p className="text-xs font-medium tracking-wide text-moss">Plantae</p>
              <h1 className="font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">Linhagem</h1>
            </div>
            <p className="hidden max-w-sm text-right text-sm text-muted sm:block">
              {GENUS_COUNT} gêneros, {SPECIES_COUNT} espécies e {SUBSPECIES_COUNT} subespécies.
            </p>
          </div>
        </header>
        <p className="px-6 py-10 text-sm text-muted">
          {catalogError ? "Não foi possível abrir o catálogo." : "Abrindo Linhagem…"}
        </p>
      </div>
    );
  }

  const selected = taxonById(selectedId);
  const plant = selected.rank === "especie" || selected.rank === "subespecie";
  const lineage = lineageOf(selectedId);
  const children = childrenOf(selectedId);
  const related = (selected.relatedIds ?? []).map((id) => taxonById(id));

  function openFromList(id: string) {
    setSelectedId(id);
    setMobileOpen(true);
  }

  function openFromDossier(id: string) {
    setSelectedId(id);
    setMobileOpen(true);
    setRankFilter("tudo");
    setQuery("");
  }

  const listHidden = mobileOpen ? "hidden md:flex" : "flex";
  const dossierHidden = mobileOpen ? "flex" : "hidden md:flex";

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="shrink-0 border-b border-line bg-bg-elevated">
        <div className="flex items-end justify-between gap-4 px-4 py-4 md:px-6">
          <div>
            <p className="text-xs font-medium tracking-wide text-moss">Plantae</p>
            <h1 className="font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
              Linhagem
            </h1>
          </div>
          <p className="hidden max-w-sm text-right text-sm text-muted sm:block">
            {GENUS_COUNT} gêneros, {SPECIES_COUNT} espécies e {SUBSPECIES_COUNT} subespécies.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${listHidden} min-h-0 w-full min-w-0 shrink-0 flex-col border-line md:w-96 md:border-r`}>
          <div className="shrink-0 space-y-3 border-b border-line px-4 py-3 md:px-4">
            <label className="relative block">
              <span className="sr-only">Buscar táxon</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nome científico ou popular"
                suppressHydrationWarning
                className="h-11 w-full rounded-md border border-line bg-bg-elevated pr-3 pl-10 text-sm text-ink outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-moss"
              />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar por categoria">
              {FILTERS.map((filter) => {
                const active = rankFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    role="tab"
                    aria-selected={!searchNeedle && active}
                    onClick={() => {
                      setRankFilter(filter.id);
                      setQuery("");
                    }}
                    className={`h-9 shrink-0 rounded-full px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-moss focus-visible:outline-none ${
                      !searchNeedle && active ? "bg-moss text-bg" : "bg-paper text-ink"
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={onListScroll}>
            {needle ? (
              <p className="px-4 pt-3 text-xs text-subtle">
                {!lowerReady
                  ? "Carregando espécies…"
                  : needle !== searchNeedle
                    ? "Buscando…"
                    : "A busca olha todos os táxons, sem o filtro."}
              </p>
            ) : null}
            {shown.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted">
                {searchNeedle
                  ? "Nenhum táxon com esse nome."
                  : rankFilter === "subespecie"
                    ? "A subespécie aparece dentro da espécie, não nesta lista."
                    : rankFilter === "especie"
                      ? "Busque o nome científico. Esta lista não abre as espécies de uma vez."
                      : "Nenhum táxon neste filtro."}
              </p>
            ) : (
              <ul style={{ paddingTop: listStart * 56, paddingBottom: Math.max(0, shown.length - listEnd) * 56 }}>
                {listItems.map((taxon) => (
                  <TaxonRow
                    key={taxon.id}
                    taxon={taxon}
                    selected={taxon.id === selectedId}
                    showRank={Boolean(searchNeedle)}
                    indent={!searchNeedle && rankFilter === "tudo" ? INDENT[taxon.rank] : undefined}
                    onSelect={() => openFromList(taxon.id)}
                  />
                ))}
              </ul>
            )}
            {visible.length > shown.length ? (
              <p className="px-4 py-3 text-xs text-subtle">
                {shown.length} de {visible.length}. Continue o nome para afunilar.
              </p>
            ) : null}
            <p className="px-4 py-4 text-xs text-subtle">
              De Viridiplantae no NCBI, mais nomes aceitos do WFO Plant List que ainda não estavam lá. Sem subfamílias nem tribos.
            </p>
          </div>
        </aside>

        <main className={`${dossierHidden} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-bg`}>
          <div key={selected.id} className="dossier-enter mx-auto w-full max-w-5xl px-4 py-5 md:px-8 md:py-8">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="mb-4 inline-flex h-11 items-center gap-2 text-sm font-medium text-moss focus-visible:ring-2 focus-visible:ring-moss focus-visible:outline-none md:hidden"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Voltar à lista
            </button>

            <p className="text-xs font-medium tracking-wide text-moss">
              {RANK_LABEL[selected.rank]}
              {selected.sheet ? ` · ficha ${selected.sheet}` : ""}
            </p>
            <h2
              className={`mt-1 font-display font-medium tracking-tight text-balance text-ink ${
                selected.scientific.length > 36 ? "text-2xl md:text-3xl" : "text-3xl md:text-4xl"
              }`}
            >
              <ScientificName taxon={selected} />
              {selected.authority ? (
                <span className="ml-2 font-sans text-base font-normal text-muted not-italic">
                  {selected.authority}
                </span>
              ) : null}
            </h2>
            {plant || selected.vernacular ? (
              <p className={`mt-1 text-lg ${selected.vernacular ? "text-muted" : "text-subtle"}`}>
                {selected.vernacular ?? "sem informação"}
              </p>
            ) : null}
            {selected.ncbiId ? (
              <p className="mt-2 text-sm text-muted">
                <a
                  href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${selected.ncbiId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line underline-offset-2 hover:text-ink"
                >
                  NCBI Taxonomy · {selected.ncbiId}
                </a>
              </p>
            ) : null}
            {selected.wfoId ? (
              <p className="mt-2 text-sm text-muted">
                <a
                  href={`https://www.worldfloraonline.org/taxon/${selected.wfoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line underline-offset-2 hover:text-ink"
                >
                  WFO Plant List · {selected.wfoId}
                </a>
              </p>
            ) : null}

            <nav aria-label="Linhagem taxonômica" className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {lineage.map((taxon, index) => {
                const current = taxon.id === selected.id;
                return (
                  <span key={taxon.id} className="inline-flex items-center gap-2">
                    {index > 0 ? <span className="text-subtle">/</span> : null}
                    <button
                      type="button"
                      onClick={() => openFromDossier(taxon.id)}
                      disabled={current}
                      className={`text-sm focus-visible:ring-2 focus-visible:ring-moss focus-visible:outline-none disabled:cursor-default ${
                        current ? "font-medium text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      <span className="block text-xs tracking-wide text-subtle">
                        {RANK_LABEL[taxon.rank]}
                      </span>
                      <ScientificName taxon={taxon} />
                    </button>
                  </span>
                );
              })}
            </nav>

            <div
              className={`mt-8 grid gap-8 ${plant || selected.image ? "lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" : ""}`}
            >
              {plant || selected.image ? (
                <figure className="overflow-hidden rounded-lg border border-line bg-bg-elevated">
                  {selected.image ? (
                    <img
                      src={selected.image}
                      alt={`Prancha botânica de ${selected.scientific}`}
                      width={1200}
                      height={1600}
                      className="h-auto w-full bg-paper"
                    />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center px-6 text-center text-sm text-subtle">
                      sem informação
                    </div>
                  )}
                  <figcaption className="border-t border-line px-4 py-3 text-xs text-muted">
                    Linhagem
                  </figcaption>
                </figure>
              ) : null}

              <div className="min-w-0 space-y-8">
                <p className={`max-w-prose text-base ${selected.summary ? "text-ink" : "text-subtle"}`}>
                  {selected.summary ??
                    (plant
                      ? "sem informação"
                      : selected.rank === "subespecie"
                        ? "Subespécie no NCBI Taxonomy, colocada direto sob a espécie."
                        : "Espécie no NCBI Taxonomy, colocada direto sob o gênero.")}
                </p>

                <ChildSection
                  selected={selected}
                  taxa={children}
                  speciesState={speciesState}
                  lowerReady={lowerReady}
                  onSelect={openFromDossier}
                />

                {plant ? <FactGrid taxon={selected} reserve /> : <FactGrid taxon={selected} />}

                {plant || selected.diagnosis ? (
                  <section>
                    <h3 className="font-display text-lg font-medium">Diagnose</h3>
                    {selected.diagnosis && selected.diagnosis.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-2 border-l border-line pl-4">
                        {selected.diagnosis.map((item) => (
                          <li key={item} className="text-sm text-ink">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-subtle">sem informação</p>
                    )}
                  </section>
                ) : null}

                {plant || selected.morphology ? (
                  <section>
                    <h3 className="font-display text-lg font-medium">Morfologia</h3>
                    <dl className="mt-3 divide-y divide-line border-y border-line">
                      {(plant ? plantMorphology(selected) : (selected.morphology ?? [])).map((item) => (
                        <div key={item.label} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                          <dt className="text-sm font-medium text-muted">{item.label}</dt>
                          <dd className={`text-sm ${item.value ? "text-ink" : "text-subtle"}`}>
                            {item.value || "sem informação"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {plant || selected.notes ? (
                  <section>
                    <h3 className="font-display text-lg font-medium">Notas</h3>
                    <p className={`mt-3 max-w-prose text-sm ${selected.notes ? "text-ink" : "text-subtle"}`}>
                      {selected.notes ?? "sem informação"}
                    </p>
                  </section>
                ) : null}

                {plant || related.length > 0 ? (
                  <section>
                    <h3 className="font-display text-lg font-medium">Espécies próximas</h3>
                    {related.length > 0 ? (
                      <ul className="mt-3 divide-y divide-line border-y border-line">
                        {related.map((taxon) => (
                          <li key={taxon.id} className="taxon-row">
                            <ChildButton taxon={taxon} onSelect={() => openFromDossier(taxon.id)} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-subtle">sem informação</p>
                    )}
                  </section>
                ) : null}

                {selected.ncbiId ? (
                  <NcbiRecord
                    taxid={selected.ncbiId}
                    preferredName={selected.scientific}
                    onOpen={openFromDossier}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ChildSection({
  selected,
  taxa,
  speciesState,
  lowerReady,
  onSelect,
}: {
  selected: Taxon;
  taxa: Taxon[];
  speciesState: "idle" | "loading" | "ready" | "error";
  lowerReady: boolean;
  onSelect: (id: string) => void;
}) {
  const waiting = selected.rank === "genero" || selected.rank === "especie" || selected.rank === "subespecie";
  if (taxa.length === 0 && waiting && (speciesState === "loading" || !lowerReady)) {
    return <p className="text-sm text-subtle">Carregando espécies…</p>;
  }
  if (taxa.length === 0 && selected.rank === "genero" && speciesState === "error") {
    return <p className="text-sm text-subtle">Não foi possível carregar as espécies deste gênero.</p>;
  }
  if (taxa.length === 0 && selected.rank === "genero" && speciesState === "ready") {
    return (
      <section>
        <h3 className="font-display text-lg font-medium">Inclui</h3>
        <p className="mt-3 text-sm text-subtle">Nenhuma espécie deste gênero no NCBI.</p>
      </section>
    );
  }
  if (taxa.length === 0) return null;
  return (
    <section>
      <h3 className="font-display text-lg font-medium">
        Inclui
        <span className="ml-2 font-sans text-sm font-normal text-muted">
          {taxa.length} {rankCountLabel(taxa[0].rank, taxa.length)}
        </span>
      </h3>
      <ChildList taxa={taxa} onSelect={onSelect} />
    </section>
  );
}

function ChildList({ taxa, onSelect }: { taxa: Taxon[]; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 80 });
  function onScroll() {
    const scroller = ref.current;
    if (!scroller) return;
    const row = 56;
    const start = Math.max(0, Math.floor(scroller.scrollTop / row) - 8);
    const end = Math.min(taxa.length, start + Math.ceil(scroller.clientHeight / row) + 16);
    setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }
  const end = Math.max(range.end, Math.min(taxa.length, 80));
  const slice = taxa.slice(range.start, end);
  return (
    <div ref={ref} className="mt-3 max-h-96 overflow-y-auto border-y border-line" onScroll={onScroll}>
      <ul style={{ paddingTop: range.start * 56, paddingBottom: Math.max(0, taxa.length - end) * 56 }}>
        {slice.map((taxon) => (
          <li key={taxon.id} className="taxon-row">
            <ChildButton taxon={taxon} onSelect={() => onSelect(taxon.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function rankCountLabel(rank: Rank, count: number): string {
  const forms: Record<Rank, [string, string]> = {
    dominio: ["domínio", "domínios"],
    reino: ["reino", "reinos"],
    divisao: ["divisão", "divisões"],
    classe: ["classe", "classes"],
    ordem: ["ordem", "ordens"],
    familia: ["família", "famílias"],
    genero: ["gênero", "gêneros"],
    especie: ["espécie", "espécies"],
    subespecie: ["subespécie", "subespécies"],
  };
  return forms[rank][count === 1 ? 0 : 1];
}

function TaxonRow({
  taxon,
  selected,
  indent,
  showRank = false,
  onSelect,
}: {
  taxon: Taxon;
  selected: boolean;
  indent?: string;
  showRank?: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="taxon-row">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex min-h-14 w-full items-center justify-between gap-3 border-l-2 py-2 pr-4 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss focus-visible:outline-none ${
          indent ?? "pl-4"
        } ${selected ? "border-moss bg-moss-soft" : "border-transparent hover:bg-paper"}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-base text-ink">
            <ScientificName taxon={taxon} />
          </span>
          {taxon.vernacular ? (
            <span className="block truncate text-sm text-muted">{taxon.vernacular}</span>
          ) : null}
        </span>
        {taxon.rank === "genero" && !showRank ? null : (
          <span className="shrink-0 text-xs text-subtle">{RANK_LABEL[taxon.rank]}</span>
        )}
      </button>
    </li>
  );
}

function ChildButton({ taxon, onSelect }: { taxon: Taxon; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-moss focus-visible:outline-none"
    >
      <span className="min-w-0">
        <span className="block truncate text-base text-ink">
          <ScientificName taxon={taxon} compact={taxon.rank === "subespecie"} />
        </span>
        {taxon.vernacular ? <span className="block text-sm text-muted">{taxon.vernacular}</span> : null}
      </span>
      {taxon.rank === "genero" ? null : (
        <span className="shrink-0 text-xs text-subtle">{RANK_LABEL[taxon.rank]}</span>
      )}
    </button>
  );
}

const PLANT_MORPHOLOGY = ["Porte", "Folhas", "Flores", "Fruto"];

function plantMorphology(taxon: Taxon): { label: string; value: string }[] {
  const known = new Map((taxon.morphology ?? []).map((item) => [item.label, item.value]));
  const reserved = PLANT_MORPHOLOGY.map((label) => ({ label, value: known.get(label) ?? "" }));
  const extra = (taxon.morphology ?? []).filter((item) => !PLANT_MORPHOLOGY.includes(item.label));
  return [...reserved, ...extra];
}

function FactGrid({ taxon, reserve = false }: { taxon: Taxon; reserve?: boolean }) {
  const facts: [string, string | undefined][] = [
    ["Hábito", taxon.habit],
    ["Hábitat", taxon.habitat],
    ["Distribuição", taxon.distribution],
    ["Altitude", taxon.elevation],
    ["Fenologia", taxon.phenology],
    ["Situação", taxon.status],
  ];
  const shown = reserve ? facts : facts.filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (shown.length === 0) return null;

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="rounded-md border border-line bg-bg-elevated px-4 py-3">
          <dt className="text-xs font-medium text-muted">{label}</dt>
          <dd className={`mt-1 text-sm ${value ? "text-ink" : "text-subtle"}`}>{value || "sem informação"}</dd>
        </div>
      ))}
    </dl>
  );
}

