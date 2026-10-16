import { useEffect, useState } from "react";
import { getNcbiProfile, type NcbiProfile } from "@/data/ncbi-profile";
import { taxonByScientific } from "@/data/flora";

const cache = new Map<number, NcbiProfile>();

export function NcbiRecord({
  taxid,
  preferredName,
  onOpen,
}: {
  taxid: number;
  preferredName: string;
  onOpen: (id: string) => void;
}) {
  const [profile, setProfile] = useState<NcbiProfile | null>(() => cache.get(taxid) ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    cache.has(taxid) ? "ready" : "loading",
  );

  useEffect(() => {
    const cached = cache.get(taxid);
    if (cached) {
      setProfile(cached);
      setStatus("ready");
      return;
    }
    let cancel = false;
    setProfile(null);
    setStatus("loading");
    getNcbiProfile({ data: taxid })
      .then((next) => {
        cache.set(taxid, next);
        if (!cancel) {
          setProfile(next);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancel) setStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [taxid]);

  return (
    <section>
      <h3 className="font-display text-lg font-medium">Registro no NCBI</h3>
      {status === "loading" ? (
        <p className="mt-3 text-sm text-muted">Buscando sinônimos e vínculos…</p>
      ) : null}
      {status === "error" ? (
        <p className="mt-3 text-sm text-muted">O NCBI não respondeu agora. Os vínculos abaixo continuam válidos.</p>
      ) : null}
      {profile ? <ProfileBody profile={profile} preferredName={preferredName} onOpen={onOpen} /> : null}
      <ul className="mt-4 flex flex-col gap-2">
        <LinkRow href={taxonomyUrl(taxid)} label="Ficha no NCBI Taxonomy" />
        {profile?.akaTaxIds.map((id) => (
          <LinkRow key={id} href={taxonomyUrl(id)} label={`Outro taxid · ${id}`} />
        ))}
        {profile?.citations.map((citation) => {
          const href = citation.url && !/pubmed\.ncbi/i.test(citation.url) ? citation.url : null;
          return (
            <li key={citation.text} className="text-sm text-ink">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line underline-offset-2 hover:text-moss"
                >
                  {citation.text}
                </a>
              ) : (
                citation.text
              )}
            </li>
          );
        })}
      </ul>
      {profile?.updated ? (
        <p className="mt-3 text-xs text-subtle">Registro atualizado em {profile.updated}.</p>
      ) : null}
    </section>
  );
}

function ProfileBody({
  profile,
  preferredName,
  onOpen,
}: {
  profile: NcbiProfile;
  preferredName: string;
  onOpen: (id: string) => void;
}) {
  const synonyms = synonymsForCatalog(profile, preferredName);
  const groups = [
    profile.authority
      ? { title: "Autoridade", names: [profile.authority], note: null }
      : null,
    profile.basionym
      ? {
          title: "Basiónimo",
          names: [profile.basionym],
          note: "O autor entre parênteses no nome aceito, quando o NCBI tem um único nome correspondente.",
        }
      : null,
    synonyms.length
      ? { title: "Sinônimos", names: synonyms, note: null }
      : null,
    profile.equivalent.length
      ? { title: "Nomes equivalentes", names: profile.equivalent, note: null }
      : null,
    profile.misspellings.length
      ? { title: "Grafias incorretas", names: profile.misspellings, note: null }
      : null,
    profile.commonNames.length
      ? { title: "Nomes populares", names: profile.commonNames, note: null }
      : null,
    profile.includes.length
      ? { title: "Nomes incluídos neste táxon", names: profile.includes, note: null }
      : null,
    profile.inPart.length ? { title: "Em parte", names: profile.inPart, note: null } : null,
  ].filter((group): group is { title: string; names: string[]; note: string | null } => Boolean(group));

  const extra = new Map<string, string[]>();
  for (const item of profile.other) {
    const list = extra.get(item.label) ?? [];
    list.push(item.name);
    extra.set(item.label, list);
  }

  const empty = groups.length === 0 && extra.size === 0;

  return (
    <div className="mt-4 space-y-5">
      {empty ? <p className="text-sm text-muted">Sem sinônimos nem basiónimo neste registro.</p> : null}
      {groups.map((group) => (
        <NameGroup key={group.title} title={group.title} names={group.names} note={group.note} onOpen={onOpen} />
      ))}
      {[...extra.entries()].map(([title, names]) => (
        <NameGroup key={title} title={title} names={names} note={null} onOpen={onOpen} />
      ))}
    </div>
  );
}

function synonymsForCatalog(profile: NcbiProfile, preferredName: string): string[] {
  const scientific = profile.scientific ?? "";
  const names = profile.synonyms.filter((name) => bareName(name) !== preferredName);
  if (!scientific || scientific === preferredName) return names;
  if (names.some((name) => bareName(name) === scientific)) return names;
  return [scientific, ...names];
}

function NameGroup({
  title,
  names,
  note,
  onOpen,
}: {
  title: string;
  names: string[];
  note: string | null;
  onOpen: (id: string) => void;
}) {
  const latin = title !== "Nomes populares";
  return (
    <div>
      <h4 className="text-xs font-medium tracking-wide text-subtle">{title}</h4>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {names.map((name) => {
          const linked = latin ? taxonByScientific(bareName(name)) : undefined;
          return (
            <li key={name} className="py-2 text-sm text-ink">
              {linked ? (
                <button
                  type="button"
                  onClick={() => onOpen(linked.id)}
                  className="text-left underline decoration-line underline-offset-2 hover:text-moss focus-visible:ring-2 focus-visible:ring-moss focus-visible:outline-none"
                >
                  <NameText value={name} latin={latin} />
                </button>
              ) : (
                <NameText value={name} latin={latin} />
              )}
            </li>
          );
        })}
      </ul>
      {note ? <p className="mt-2 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}

function NameText({ value, latin }: { value: string; latin: boolean }) {
  if (!latin) return <span>{value}</span>;
  const split = splitAuthor(value);
  if (!split) return <ScientificBits name={value} />;
  return (
    <>
      <ScientificBits name={split.name} />
      <span className="text-muted"> {split.author}</span>
    </>
  );
}

function splitAuthor(value: string): { name: string; author: string } | null {
  const match = value.match(/^(.*?)(\s+\([^)]+\)\s+.+|\s+[A-Z](?:[A-Za-z.\-]+|\.)(?:,\s*\d{4})?.*)$/);
  if (!match) return null;
  const name = match[1].trim();
  const author = match[2].trim();
  if (!name || !author || author.length > name.length + 40) return null;
  return { name, author };
}

function ScientificBits({ name }: { name: string }) {
  const parts = name.split(/(\s+(?:subsp\.|ssp\.|var\.|f\.|subg\.|nothosubsp\.)\s+)/);
  return (
    <span className="font-display text-taxon">
      {parts.map((part, index) =>
        /subsp\.|ssp\.|var\.|f\.|subg\.|nothosubsp\./.test(part) ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index} className="italic">
            {part}
          </span>
        ),
      )}
    </span>
  );
}

function bareName(value: string): string {
  return splitAuthor(value)?.name ?? value;
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-moss underline decoration-line underline-offset-2 hover:text-ink"
      >
        {label}
      </a>
    </li>
  );
}

function taxonomyUrl(taxid: number): string {
  return `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${taxid}`;
}
