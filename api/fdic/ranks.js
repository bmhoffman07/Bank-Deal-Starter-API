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

export default async function handler() {
  try {
    const fields = 'NAME,DEPDOM';
    const res = await fdic('institutions', {
      fields,
      sort_by: 'DEPDOM',
      sort_order: 'desc',
      limit: 400,
    });
    const rows = (res?.data || []).map(r => ({
      bank: r.NAME,
      total_mm: Number(kToMM(r.DEPDOM).toFixed(3)),
    }));
    return json({ rows });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}
