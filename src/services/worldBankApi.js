// Lightweight client for World Bank REST API v2 (JS version)
const BASE_URL = 'https://api.worldbank.org/v2';
const DEFAULTS = { lang: 'en', format: 'json', per_page: 1000 };

async function getCountries(q) {
  const url = new URL(`${BASE_URL}/country`);
  url.searchParams.set('format', DEFAULTS.format);
  url.searchParams.set('per_page', DEFAULTS.per_page);
  url.searchParams.set('lang', DEFAULTS.lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WorldBank API error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2) throw new Error('Unexpected WorldBank response shape');
  const data = json[1];
  if (!q) return data;
  const query = q.toLowerCase();
  return data.filter(c => 
    c.name.toLowerCase().includes(query) ||
    c.iso2Code.toLowerCase() === query ||
    c.id.toLowerCase() === query
  );
}

/**
 * Search indicators by keyword.
 */
async function getIndicators(q) {
  const url = new URL(`${BASE_URL}/indicator`);
  url.searchParams.set('format', DEFAULTS.format);
  url.searchParams.set('per_page', DEFAULTS.per_page);
  url.searchParams.set('lang', DEFAULTS.lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WorldBank API error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2) throw new Error('Unexpected WorldBank response shape');
  let data = json[1];
  if (!q) return data;
  const query = q.toLowerCase();
  return data.filter(ind =>
    ind.name.toLowerCase().includes(query) ||
    ind.id.toLowerCase().includes(query)
  );
}

/**
 * Fetch time-series data for a given indicator across ALL countries in a single call.
 * More efficient and comprehensive than fetching individual countries.
 */
async function getIndicatorDataAllCountries(indicator, start, end, lang = DEFAULTS.lang) {
  const url = new URL(`${BASE_URL}/country/all/indicator/${indicator}`);
  url.searchParams.set('format', DEFAULTS.format);
  url.searchParams.set('per_page', '32500'); // World Bank API maximum
  if (start !== undefined && end !== undefined) url.searchParams.set('date', `${start}:${end}`);
  url.searchParams.set('lang', lang);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json) || json.length < 2) return [];

    const metadata = json[0];
    const data = json[1] || [];

    // Check if there are more pages
    if (metadata && metadata.pages > 1) {
      console.log(`Indicator ${indicator} has ${metadata.total} records across ${metadata.pages} pages. Fetching all pages...`);

      // Fetch remaining pages in parallel
      const pagePromises = [];
      for (let page = 2; page <= Math.min(metadata.pages, 10); page++) { // Limit to 10 pages max
        const pageUrl = new URL(url);
        pageUrl.searchParams.set('page', page.toString());
        pagePromises.push(
          fetch(pageUrl)
            .then(r => r.ok ? r.json() : null)
            .then(j => (j && Array.isArray(j) && j.length > 1) ? j[1] : [])
            .catch(() => [])
        );
      }

      const additionalPages = await Promise.all(pagePromises);
      const allData = data.concat(...additionalPages.filter(p => p.length > 0));
      console.log(`Fetched ${allData.length} total records from ${metadata.pages} pages`);
      return allData;
    }

    return data;
  } catch (err) {
    console.warn(`Failed to fetch ${indicator} for all countries:`, err);
    return [];
  }
}

/**
 * Fetch time-series data for a given indicator & country list.
 * Fetches all countries in parallel for better performance.
 */
async function getIndicatorData(countryCodes, indicator, start, end, lang = DEFAULTS.lang) {
  if (!Array.isArray(countryCodes)) countryCodes = [countryCodes];

  // Create all fetch promises at once (parallel)
  const fetchPromises = countryCodes.map(async (code) => {
    const url = new URL(`${BASE_URL}/country/${code}/indicator/${indicator}`);
    url.searchParams.set('format', DEFAULTS.format);
    url.searchParams.set('per_page', DEFAULTS.per_page);
    if (start !== undefined && end !== undefined) url.searchParams.set('date', `${start}:${end}`);
    url.searchParams.set('lang', lang);

    try {
      const res = await fetch(url);
      if (!res.ok) return { code, data: null };
      const json = await res.json();
      if (!Array.isArray(json) || json.length < 2) return { code, data: null };
      return { code, data: json[1] };
    } catch (err) {
      console.warn(`Failed to fetch ${indicator} for ${code}:`, err);
      return { code, data: null };
    }
  });

  // Wait for all fetches to complete in parallel
  const responses = await Promise.all(fetchPromises);

  // Convert to results object
  const results = {};
  responses.forEach(({ code, data }) => {
    if (data) results[code] = data;
  });

  return results;
}

export { getCountries, getIndicators, getIndicatorData, getIndicatorDataAllCountries };
