// Vercel Edge Function: drop-in Starter API for the Bank Deal Summary app
// Live-first: proxies FDIC BankFind Suite so you don't need your own database.
// Endpoints implemented:
//  - GET /fdic/sod?bank=Exact%20Bank%20Name
//  - GET /fdic/sod/names?query=partial
//  - GET /fdic/ranks
//  - GET /deal-dates?acquirer=...&target=...        (returns null for now)
//  - GET /ffiec/loan-mix?acquirer=...&target=...    (empty for now)
//  - GET /offers/checking?cbsa_code=nnnnn&banks=A,B (empty for now)
//
// How to use:
// 1) Create a GitHub repo and add this file at /api/index.js
// 2) Import the repo into Vercel (vercel.com > Add New > Project) and Deploy.
// 3) Your Base URL will be: https://<your-project>.vercel.app/api
// 4) Paste that into the app's "API Base URL" field.
//
// Notes:
// - FDIC BankFind API docs: https://banks.data.fdic.gov/docs/ (fields & filter syntax)
// - Amounts from FDIC are typically in $000s; we convert to $MM in this API.
// - This is intentionally small and dependency-free.

export const config = { runtime: 'edge' };

const FDIC_BASE = 'https://banks.data.fdic.gov/api';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 's-maxage=3600, stale-while-revalidate=86400',
      'access-control-allow-origin': '*',
    },
  });
}

async function fdic(path, params = {}) {
  const url = new URL(`${FDIC_BASE}/${path}`);
  Object.entries({ format: 'json', ...params }).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const resp = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`FDIC error ${resp.status}`);
  return await resp.json();
}

function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function kToMM(x) { return toNumber(x) / 1000; } // $000s -> $MM

// Map a SOD/location record into the frontend-friendly row
function mapSod(rec, fallbackName) {
  const r = rec || {};
  // FDIC field aliases across datasets
  const cbsa = r.CBSA || r.CBSA_NAME || r.MSAC_NAME || r.CBSANAME || r.CBSA_TTL || r.CBSATITLE || r.MSA_MD || r.MSA || null;
  const cbsaCode = r.CBSA_NO || r.CBSA || r.CBSA_CODE || r.MSAC || r.MD || r.CBSACODE || null;
  const lat = r.LATITUDE || r.LAT || r.latitude || null;
  const lon = r.LONGITUDE || r.LON || r.longitude || null;
  // Deposits: DEPDOM (domestic deposits $000s) or DEPSUMBR depending on dataset
  const depK = r.DEPDOM ?? r.DEPSUMBR ?? r.DEP ?? r.TOTDEP ?? 0;
  return {
    bank_name: r.NAME || fallbackName || 'n/a',
    cbsa: cbsa || 'n/a',
    cbsa_code: cbsaCode || null,
    address: r.ADDRESS || r.ADDR || r.ADDRESS1 || r.ADDRESSBR || r.STADDR || 'n/a',
    latitude: lat != null ? toNumber(lat) : null,
    longitude: lon != null ? toNumber(lon) : null,
    office_deposits_mm: Number(kToMM(depK).toFixed(3)),
  };
}

export default async function handler(req) {
  const { pathname, searchParams } = new URL(req.url);
  try {
    // ----- /fdic/sod -----
    if (pathname.endsWith('/fdic/sod')) {
      const name = (searchParams.get('bank') || '').trim();
      if (!name) return json({ rows: [] });
      // Prefer SOD dataset; fall back to locations when needed.
      // Pull most recent year by sorting desc; grab plenty of rows.
      const fields = [
        'NAME','ADDRESS','CBSA','CBSA_NO','LATITUDE','LONGITUDE','DEPDOM','CITY','STALP','ZIP','YEAR'
      ].join(',');
      let data;
      try {
        data = await fdic('sod', {
          filters: `NAME:"${name}"`,
          fields,
          sort_by: 'YEAR',
          sort_order: 'desc',
          limit: 10000,
        });
      } catch (_) {
        // Fallback to locations dataset
        const locFields = 'NAME,ADDRESS,CBSA,CBSA_NO,LATITUDE,LONGITUDE,DEPDOM,CITY,STALP,ZIP';
        data = await fdic('locations', {
          filters: `NAME:"${name}"`,
          fields: locFields,
          limit: 10000,
        });
      }
      const raw = Array.isArray(data?.data) ? data.data : [];
      const rows = raw.map((rec) => mapSod(rec, name));
      return json({ rows });
    }

    // ----- /fdic/sod/names -----
    if (pathname.endsWith('/fdic/sod/names')) {
      const q = (searchParams.get('query') || '').trim();
      // Using institutions dataset for fast name search (active institutions prioritized)
      const fields = 'NAME,ACTIVE,OFFDOM';
      const filters = q ? `NAME:(*${q.replace(/"/g,'')}*)` : 'ACTIVE:1';
      const res = await fdic('institutions', {
        filters,
        fields,
        sort_by: q ? 'OFFDOM' : 'NAME',
        sort_order: q ? 'desc' : 'asc',
        limit: 200,
      });
      const names = Array.from(new Set((res?.data || []).map((r) => r.NAME).filter(Boolean)));
      return json({ rows: names });
    }

    // ----- /fdic/ranks -----
    if (pathname.endsWith('/fdic/ranks')) {
      // Grab top institutions by domestic deposits; convert to $MM
      const fields = 'NAME,DEPDOM';
      const res = await fdic('institutions', {
        fields,
        sort_by: 'DEPDOM',
        sort_order: 'desc',
        limit: 400,
      });
      const rows = (res?.data || []).map((r) => ({ bank: r.NAME, total_mm: Number(kToMM(r.DEPDOM).toFixed(3)) }));
      return json({ rows });
    }

    // ----- /deal-dates ----- (not available from FDIC; return null so UI shows n/a)
    if (pathname.endsWith('/deal-dates')) {
      return json(null);
    }

    // ----- /ffiec/loan-mix ----- (placeholder)
    if (pathname.endsWith('/ffiec/loan-mix')) {
      return json({ rows: [] });
    }

    // ----- /offers/checking ----- (placeholder)
    if (pathname.endsWith('/offers/checking')) {
      return json({ rows: [] });
    }

    return json({ error: 'Not Found' }, 404);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
