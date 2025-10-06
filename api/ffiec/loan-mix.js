export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response(JSON.stringify({ rows: [] }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}
