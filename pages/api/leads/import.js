// pages/api/leads/import.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const {
    link, title, description,
    price, images, ai,
    source, createdAt
  } = req.body || {};

  const missing = [];
  if (!link)                    missing.push('link');
  if (!title)                   missing.push('title');
  if (!description)             missing.push('description');
  if (typeof price !== 'number')missing.push('price (number)');
  if (!Array.isArray(images))   missing.push('images (array)');
  if (typeof ai !== 'object')   missing.push('ai (object)');
  if (!source)                  missing.push('source');
  if (!createdAt)               missing.push('createdAt');

  if (missing.length) {
    return res.status(400).json({
      error: 'Missing or invalid required fields',
      missing
    });
  }

  // TODO: Insert into your database here

  return res.status(200).json({ success: true });
}
