/* eslint-disable @typescript-eslint/no-explicit-any */
const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

function buildSparqlQuery(artistName: string) {
  const escaped = artistName.replace(/"/g, '\\"');
  return `
SELECT ?image WHERE {
  ?artist wikibase:sitelinks ?links ;
          rdfs:label "${escaped}"@en .
  OPTIONAL { ?artist wdt:P18 ?image . }
}
LIMIT 1
  `.trim();
}

export function createWikidataImageClient({
  fetchImpl = fetch,
  timeoutMs = 8000,
  lastFmApiKey = "",
}: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lastFmApiKey?: string;
} = {}) {
  async function fetchWithTimeout(url: string, options: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  async function getFromWikidata(artistName: string): Promise<string | null> {
    const query = buildSparqlQuery(artistName);
    const url = `${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetchWithTimeout(url, {
      headers: { accept: "application/sparql-results+json", "user-agent": "bandsearch-app/0.1" },
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const bindings = data?.results?.bindings ?? [];
    const imageBinding = bindings[0]?.image?.value;
    if (!imageBinding) return null;
    return imageBinding;
  }

  async function getFromLastFm(artistName: string): Promise<string | null> {
    if (!lastFmApiKey) return null;
    const url = `${LASTFM_API_URL}?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${lastFmApiKey}&format=json`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const data: any = await response.json();
    const images = data?.artist?.image ?? [];
    const large = images.find((img: any) => img.size === "extralarge") || images[images.length - 1];
    const url2 = large?.["#text"];
    return url2 && url2.trim() ? url2 : null;
  }

  return {
    async getArtistImageUrl(artistName: string): Promise<string | null> {
      if (!artistName) return null;
      try {
        const wikidataUrl = await getFromWikidata(artistName);
        if (wikidataUrl) return wikidataUrl;
      } catch {
        // fall through to Last.fm
      }
      try {
        return await getFromLastFm(artistName);
      } catch {
        return null;
      }
    },
  };
}
