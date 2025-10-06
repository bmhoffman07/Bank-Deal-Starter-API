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

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('query') || '').trim().replace(/"/g, '');
    const fields = 'NAME,ACTIVE,OFFDOM';
    const filters = q ? `NAME:(*${q}*)` : 'ACTIVE:1';
    const res = await fdic('institutions', {
      filters,
      fields,
      sort_by: q ? 'OFFDOM' : 'NAME',
      sort_order: q ? 'desc' : 'asc',
      limit: 200,
    });
    const names = Array.from(new Set((res?.data || []).map(r => r.NAME).filter(Boolean)));
    return json({ rows: names });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
