export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { endpoint } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: { error: 'Missing endpoint parameter' } });
  }

  const decodedEndpoint = decodeURIComponent(endpoint);

  try {
    const tornRes = await fetch(`https://api.torn.com/${decodedEndpoint}`);
    const data = await tornRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: { error: 'Proxy fetch failed: ' + err.message } });
  }
}
