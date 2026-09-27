// Backend pentru panoul de administrare a galeriei (/admin).
// Citeste si modifica gallery.json + pozele direct in repo-ul GitHub; fiecare actiune = un commit,
// dupa care GitHub Pages si Vercel republica site-ul singure.
//
// Variabile de mediu (Vercel -> Settings -> Environment Variables):
//   GITHUB_TOKEN            token fine-grained, DOAR repo-ul dandak-site, permisiunea Contents: Read and write
//   GALLERY_ADMIN_PASSWORD  parola panoului
//   GITHUB_REPO             optional, implicit dagafitei72-cpu/dandak-site
//   GITHUB_BRANCH           optional, implicit main
const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'dagafitei72-cpu/dandak-site';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const GALLERY_PATH = 'gallery.json';
const UPLOAD_DIR = 'images/galerie';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PROJECTS = 30;
const MAX_IMAGES_PER_PROJECT = 40;
const MAX_TITLE_LENGTH = 60;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function passwordOk(given) {
  const expected = process.env.GALLERY_ADMIN_PASSWORD;
  if (!expected || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

// ---------------------------------------------------------------- GitHub API

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dandak-gallery-admin',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path}: ${res.status} ${data && data.message}`);
    err.githubStatus = res.status;
    throw err;
  }
  return data;
}

async function readState() {
  const ref = await gh('GET', `/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const commit = await gh('GET', `/git/commits/${headSha}`);
  const file = await gh('GET', `/contents/${GALLERY_PATH}?ref=${headSha}`);
  const gallery = normalizeGallery(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
  return { headSha, treeSha: commit.tree.sha, gallery };
}

async function createBlob(buffer) {
  const blob = await gh('POST', '/git/blobs', { content: buffer.toString('base64'), encoding: 'base64' });
  return blob.sha;
}

async function writeCommit(state, change) {
  const galleryJson = JSON.stringify(state.gallery, null, 2) + '\n';
  const gallerySha = await createBlob(Buffer.from(galleryJson, 'utf8'));
  const entries = [{ path: GALLERY_PATH, mode: '100644', type: 'blob', sha: gallerySha }];
  for (const f of change.add || []) entries.push({ path: f.path, mode: '100644', type: 'blob', sha: f.sha });
  const removals = (change.remove || []).map(p => ({ path: p, mode: '100644', type: 'blob', sha: null }));

  let tree;
  try {
    tree = await gh('POST', '/git/trees', { base_tree: state.treeSha, tree: entries.concat(removals) });
  } catch (e) {
    // Un fisier de sters care nu mai exista in repo face ca GitHub sa refuze tot arborele.
    if (e.githubStatus !== 422 || !removals.length) throw e;
    tree = await gh('POST', '/git/trees', { base_tree: state.treeSha, tree: entries });
  }
  const commit = await gh('POST', '/git/commits', {
    message: change.message,
    tree: tree.sha,
    parents: [state.headSha]
  });
  await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
}

// Citeste starea curenta, aplica modificarea si face commit. Daca intre timp a mai aparut
// un commit (ref-ul nu mai e fast-forward), o ia de la capat pe starea noua.
async function mutate(apply) {
  for (let attempt = 1; ; attempt++) {
    const state = await readState();
    const change = apply(state.gallery);
    try {
      await writeCommit(state, change);
      return state.gallery;
    } catch (e) {
      if (e.githubStatus === 422 && attempt < 3) continue;
      throw e;
    }
  }
}

// ------------------------------------------------------------------- Galerie

function normalizeGallery(g) {
  const projects = Array.isArray(g && g.projects) ? g.projects : [];
  return {
    version: 1,
    projects: projects
      .filter(p => p && typeof p.id === 'string')
      .map(p => ({
        id: p.id,
        title: {
          fr: String((p.title && p.title.fr) || p.id),
          nl: String((p.title && (p.title.nl || p.title.fr)) || p.id),
          en: String((p.title && (p.title.en || p.title.fr)) || p.id)
        },
        images: Array.isArray(p.images) ? p.images.filter(i => typeof i === 'string') : []
      }))
  };
}

function findProject(gallery, id) {
  const project = gallery.projects.find(p => p.id === id);
  if (!project) throw new HttpError(404, 'Proiectul nu mai există. Reîncarcă pagina.');
  return project;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('fr').slice(0, MAX_TITLE_LENGTH);
}

function cleanTitle(title) {
  const fr = cleanText(title && title.fr);
  if (!fr) throw new HttpError(400, 'Scrie măcar titlul în franceză.');
  return {
    fr,
    nl: cleanText(title && title.nl) || fr,
    en: cleanText(title && title.en) || fr
  };
}

function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proiect';
}

function uniqueId(gallery, base) {
  let id = base;
  for (let n = 2; gallery.projects.some(p => p.id === id); n++) id = `${base}-${n}`;
  return id;
}

// Doar pozele puse din panou (images/galerie/...) se sterg si din repo;
// pozele originale ale site-ului sunt doar scoase din galerie.
function isUploaded(path) {
  return path.startsWith(`${UPLOAD_DIR}/`);
}

function decodeJpeg(data) {
  if (typeof data !== 'string' || !data) throw new HttpError(400, 'Poza lipsește.');
  const buffer = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buffer.length < 1000) throw new HttpError(400, 'Poza e goală sau stricată.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Poza e prea mare.');
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new HttpError(400, 'Poza trebuie să fie JPG.');
  }
  return buffer;
}

function newImagePath(projectId) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${UPLOAD_DIR}/${projectId}/${stamp}-${crypto.randomBytes(3).toString('hex')}.jpg`;
}

async function runAction(action, body) {
  switch (action) {
    case 'login':
      return null;

    case 'list':
      return (await readState()).gallery;

    case 'upload': {
      const buffer = decodeJpeg(body.image);
      const sha = await createBlob(buffer);
      return mutate(g => {
        const p = findProject(g, body.projectId);
        if (p.images.length >= MAX_IMAGES_PER_PROJECT) {
          throw new HttpError(400, `Un proiect poate avea maximum ${MAX_IMAGES_PER_PROJECT} de poze.`);
        }
        const path = newImagePath(p.id);
        p.images.push(path);
        return { message: `Galerie: poză nouă în ${p.title.fr} (panou admin)`, add: [{ path, sha }] };
      });
    }

    case 'delete-image':
      return mutate(g => {
        const p = findProject(g, body.projectId);
        if (!p.images.includes(body.path)) throw new HttpError(404, 'Poza nu mai există. Reîncarcă pagina.');
        p.images = p.images.filter(i => i !== body.path);
        const stillUsed = g.projects.some(o => o.images.includes(body.path));
        return {
          message: `Galerie: poză ștearsă din ${p.title.fr} (panou admin)`,
          remove: isUploaded(body.path) && !stillUsed ? [body.path] : []
        };
      });

    case 'set-cover':
      return mutate(g => {
        const p = findProject(g, body.projectId);
        if (!p.images.includes(body.path)) throw new HttpError(404, 'Poza nu mai există. Reîncarcă pagina.');
        p.images = [body.path].concat(p.images.filter(i => i !== body.path));
        return { message: `Galerie: poză principală nouă pentru ${p.title.fr} (panou admin)` };
      });

    case 'create-project':
      return mutate(g => {
        if (g.projects.length >= MAX_PROJECTS) throw new HttpError(400, `Maximum ${MAX_PROJECTS} de proiecte.`);
        const title = cleanTitle(body.title);
        g.projects.push({ id: uniqueId(g, slugify(title.fr)), title, images: [] });
        return { message: `Galerie: proiect nou ${title.fr} (panou admin)` };
      });

    case 'rename-project':
      return mutate(g => {
        const p = findProject(g, body.projectId);
        const old = p.title.fr;
        p.title = cleanTitle(body.title);
        return { message: `Galerie: ${old} redenumit în ${p.title.fr} (panou admin)` };
      });

    case 'move-project':
      return mutate(g => {
        const i = g.projects.findIndex(p => p.id === body.projectId);
        if (i < 0) throw new HttpError(404, 'Proiectul nu mai există. Reîncarcă pagina.');
        const j = body.direction === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= g.projects.length) throw new HttpError(400, 'Proiectul e deja la capăt.');
        [g.projects[i], g.projects[j]] = [g.projects[j], g.projects[i]];
        return { message: `Galerie: ordine schimbată pentru ${g.projects[j].title.fr} (panou admin)` };
      });

    case 'delete-project':
      return mutate(g => {
        const p = findProject(g, body.projectId);
        g.projects = g.projects.filter(o => o.id !== p.id);
        const stillUsed = new Set(g.projects.flatMap(o => o.images));
        return {
          message: `Galerie: proiectul ${p.title.fr} șters (panou admin)`,
          remove: p.images.filter(i => isUploaded(i) && !stillUsed.has(i))
        };
      });

    default:
      throw new HttpError(400, 'Acțiune necunoscută.');
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GITHUB_TOKEN || !process.env.GALLERY_ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Panoul nu e configurat încă (lipsesc variabilele pe Vercel).' });
  }

  const body = req.body || {};
  if (!passwordOk(body.password)) {
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Parolă greșită.' });
  }

  try {
    const gallery = await runAction(body.action, body);
    return res.status(200).json({ ok: true, gallery });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error('gallery admin:', e);
    return res.status(502).json({ error: 'Nu am putut salva. Încearcă din nou peste un minut.' });
  }
};

// Exportate pentru teste locale.
module.exports._internal = { normalizeGallery, cleanTitle, slugify, uniqueId, decodeJpeg, isUploaded, runAction };
