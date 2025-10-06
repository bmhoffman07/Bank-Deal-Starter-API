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

const kToMM = (x) => Number(x || 0) / 1000;

function mapSod(rec, fallbackName) {
  const r = rec || {};
  const cbsa = r.CBSA || r.CBSA_NAME || r.MSAC_NAME || r.CBSANAME || r.CBSA_TTL || r.CBSATITLE || r.MSA_MD || r.MSA || null;
  const cbsaCode = r.CBSA_NO || r.CBSA || r.CBSA_CODE || r.MSAC || r.MD || r.CBSACODE || null;
  const lat = r.LATITUDE || r.LAT || r.latitude || null;
  const lon = r.LONGITUDE || r.LON || r.longitude || null;
  const depK = r.DEPDOM ?? r.DEPSUMBR ?? r.DEP ?? r.TOTDEP ?? 0;
  return {
    bank_name: r.NAME || fallbackName || 'n/a',
    cbsa: cbsa || 'n/a',
    cbsa_code: cbsaCode || null,
    address: r.ADDRESS || r.ADDR || r.ADDRESS1 || r.ADDRESSBR || r.STADDR || 'n/a',
    latitude: lat != null ? Number(lat) : null,
    longitude: lon != null ? Number(lon) : null,
    office_deposits_mm: Number(kToMM(depK).toFixed(3)),
  };
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get('bank') || '').trim();
    if (!name) return json({ rows: [] });

    // Try SOD dataset (prefer) then fall back to locations
    const fields = 'NAME,ADDRESS,CBSA,CBSA_NO,LATITUDE,LONGITUDE,DEPDOM,CITY,STALP,ZIP,YEAR';
    let data;
    try {
      data = await fdic('sod', {
        filters: `NAME:"${name}"`,
        fields,
        sort_by: 'YEAR',
        sort_order: 'desc',
        limit: 10000,
      });
    } catch {
      const locFields = 'NAME,ADDRESS,CBSA,CBSA_NO,LATITUDE,LONGITUDE,DEPDOM,CITY,STALP,ZIP';
      data = await fdic('locations', {
        filters: `NAME:"${name}"`,
        fields: locFields,
        limit: 10000,
      });
    }

    const rows = (Array.isArray(data?.data) ? data.data : []).map((rec) => mapSod(rec, name));
    return json({ rows });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
