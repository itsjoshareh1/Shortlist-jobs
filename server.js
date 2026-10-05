// Shortlist: finds live job postings and ranks them against a resume.
// No dependencies. Run: node server.js  (optional: ANTHROPIC_API_KEY for AI ranking)
const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env (KEY=value lines) without a dependency; real env vars win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = process.env.PORT || 4317;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.SHORTLIST_MODEL || "claude-sonnet-5-5";
const UA = "Mozilla/5.0 (Shortlist job search)";

// ---------- text utilities ----------
const STOP = new Set(("a an and are as at be by for from has have in is it its of on or that the to was were will with you your we our us they their this these those i me my he she them not but if into than then so such can could would should may might must also more most other some any all each per via about over under within across both being been do does did done etc using use used work working team teams role roles job jobs year years experience experienced strong ability able including include includes new well help across make making who what when where which while how why one two three plus get great good best looking join company opportunity candidate candidates position responsibilities requirements required preferred skills knowledge understanding environment based day days time full part like etc").split(/\s+/));

function stripHtml(s = "") {
  return String(s)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function tokens(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .split(/[\s/,-]+/)
    .map(t => t.replace(/^\.+|\.+$/g, ""))
    .filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}
function terms(text) {
  const t = tokens(text), out = [...t];
  for (let i = 0; i < t.length - 1; i++) out.push(t[i] + " " + t[i + 1]);
  return out;
}
function tf(list) { const m = new Map(); for (const x of list) m.set(x, (m.get(x) || 0) + 1); return m; }

// ---------- job sources ----------
async function getJSON(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status + " " + url);
    return await r.json();
  } finally { clearTimeout(t); }
}
const job = (o) => ({ ...o, description: stripHtml(o.description).slice(0, 6000) });

const SOURCES = {
  async remotive(q) {
    const all = [];
    for (const term of q.searchTerms.slice(0, 2)) {
      const d = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=60`);
      for (const j of d.jobs || []) all.push(job({
        id: "remotive-" + j.id, source: "Remotive", title: j.title, company: (j.company_name || "").trim(),
        location: j.candidate_required_location || "Remote", remote: true, url: j.url, posted: j.publication_date,
        salary: j.salary || "", tags: j.tags || [], description: j.description,
      }));
    }
    return all;
  },
  async remoteok() {
    const d = await getJSON("https://remoteok.com/api");
    return d.filter(j => j.id && j.position).map(j => job({
      id: "remoteok-" + j.id, source: "Remote OK", title: j.position, company: j.company, location: j.location || "Remote",
      remote: true, url: j.url, posted: j.date,
      salary: +j.salary_max ? `$${Math.round(j.salary_min / 1000)}k–$${Math.round(j.salary_max / 1000)}k` : "",
      tags: j.tags || [], description: j.description,
    }));
  },
  async jobicy(q) {
    const all = [];
    for (const term of q.searchTerms.slice(0, 2)) {
      const d = await getJSON(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(term)}`);
      for (const j of d.jobs || []) all.push(job({
        id: "jobicy-" + j.id, source: "Jobicy", title: j.jobTitle, company: j.companyName, location: (j.jobGeo || "Remote") + " (remote)",
        remote: true, url: j.url, posted: j.pubDate,
        salary: j.salaryMin ? `${j.salaryCurrency || ""} ${j.salaryMin}–${j.salaryMax} ${j.salaryPeriod || ""}`.trim() : "",
        tags: [].concat(j.jobIndustry || []), description: j.jobDescription || j.jobExcerpt,
      }));
    }
    return all;
  },
  async themuse(q) {
    const level = { Entry: "Entry Level", Mid: "Mid Level", Senior: "Senior Level", "Lead / Staff": "Senior Level", "Manager+": "Management" }[q.level];
    const params = new URLSearchParams();
    if (level) params.append("level", level);
    for (const c of q.museCategories) params.append("category", c);
    if (q.mode === "Remote") params.append("location", "Flexible / Remote");
    else if (q.location) params.append("location", q.location);
    const pages = await Promise.all([1, 2, 3].map(p => getJSON(`https://www.themuse.com/api/public/jobs?page=${p}&${params}`).catch(() => ({ results: [] }))));
    return pages.flatMap(d => d.results || []).map(j => {
      const locs = (j.locations || []).map(l => l.name).join(" · ");
      return job({
        id: "muse-" + j.id, source: "The Muse", title: j.name, company: j.company?.name || "", location: locs || "Not listed",
        remote: /remote|flexible/i.test(locs), url: j.refs?.landing_page, posted: j.publication_date, salary: "",
        tags: (j.categories || []).map(c => c.name), description: j.contents,
      });
    });
  },
  async arbeitnow() {
    const pages = await Promise.all([1, 2].map(p => getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${p}`).catch(() => ({ data: [] }))));
    return pages.flatMap(d => d.data || []).map(j => job({
      id: "arbeitnow-" + j.slug, source: "Arbeitnow", title: j.title, company: j.company_name, location: j.location + (j.remote ? " (remote ok)" : ""),
      remote: !!j.remote, url: j.url, posted: j.created_at ? new Date(j.created_at * 1000).toISOString() : "", salary: "",
      tags: j.tags || [], description: j.description,
    }));
  },
};

const MUSE_MAP = [
  [/engineer|developer|software|devops|sre|backend|frontend|full.?stack|ios|android/, "Software Engineering"],
  [/data|analyst|analytics|scientist|machine learning|ml\b|ai\b/, "Data and Analytics"],
  [/design|ux|ui\b|product designer|visual|graphic/, "Design and UX"],
  [/product manager|product owner|\bpm\b/, "Product Management"],
  [/marketing|growth|seo|content|brand|social/, "Marketing"],
  [/sales|account executive|business development|sdr|bdr/, "Sales"],
  [/project manager|program manager|scrum/, "Project Management"],
  [/customer|support|success/, "Customer Service"],
  [/finance|accountant|accounting|controller/, "Accounting and Finance"],
  [/recruit|hr\b|people|talent/, "Human Resources and Recruitment"],
  [/writer|editor|copy/, "Writing and Editing"],
  [/operations|ops\b/, "Business Operations"],
  [/nurse|medical|health|clinical/, "Healthcare"],
  [/teacher|education|instructor/, "Education"],
  [/it\b|sysadmin|network|help ?desk/, "IT"],
];

// ---------- ranking ----------
function buildQuery(p) {
  const role = (p.role || "").trim();
  const resumeTerms = tf(tokens(p.resume || ""));
  const topWords = [...resumeTerms.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 3);
  const roleCore = role.toLowerCase().replace(/\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|head of|remote)\b/g, "").replace(/\s+/g, " ").trim();
  const searchTerms = [...new Set([roleCore, roleCore.split(" ").slice(-1)[0], ...topWords].filter(Boolean))];
  const hay = (role + " " + (p.resume || "").slice(0, 800)).toLowerCase();
  const museCategories = MUSE_MAP.filter(([re]) => re.test(role.toLowerCase())).map(x => x[1]);
  if (!museCategories.length) museCategories.push(...MUSE_MAP.filter(([re]) => re.test(hay)).map(x => x[1]).slice(0, 2));
  return { role, searchTerms, museCategories, level: p.level, mode: p.mode, location: (p.location || "").trim() };
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief)\b/i;
const JUNIOR = /\b(junior|jr\.?|intern|internship|entry|graduate|trainee|apprentice)\b/i;

const WEAK = /^(led|lead|built|build|ran|run|managed|engineers?|senior|junior|built|created|worked|services|systems|products?)$|^(engineer|designer|manager|developer|senior|led) (senior|lead|staff|backend|frontend)$/;

function rank(jobs, p) {
  const resumeText = `${p.role} ${p.role} ${p.resume || ""}`;
  const docs = jobs.map(j => terms(`${j.title} ${j.title} ${j.title} ${(j.tags || []).join(" ")} ${(j.tags || []).join(" ")} ${j.description}`));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length + 1;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
  const vec = (list) => { const v = new Map(); for (const [t, c] of tf(list)) v.set(t, (1 + Math.log(c)) * idf(t)); return v; };
  const norm = (v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  const rv = vec(terms(resumeText)), rn = norm(rv);
  const resumeKeys = [...rv.entries()].filter(([t]) => (df.get(t) || 0) < docs.length * 0.5).sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 80);

  const roleToks = tokens(p.role || "").filter(t => !SENIOR.test(t) && !JUNIOR.test(t));
  const wantSenior = /Senior|Lead|Manager/.test(p.level || ""), wantJunior = p.level === "Entry";
  const locToks = tokens(p.location || "").filter(t => t !== "remote");

  const scored = jobs.map((j, i) => {
    const jv = vec(docs[i]);
    let dot = 0; for (const [t, w] of rv) { const x = jv.get(t); if (x) dot += w * x; }
    const cos = dot / (rn * norm(jv));
    const titleToks = new Set(tokens(j.title));
    const titleHit = roleToks.length ? roleToks.filter(t => titleToks.has(t)).length / roleToks.length : 0;
    let adj = 0;
    if (wantJunior && SENIOR.test(j.title)) adj -= 0.25;
    if (wantSenior && JUNIOR.test(j.title)) adj -= 0.3;
    if (wantSenior && SENIOR.test(j.title)) adj += 0.05;
    if (p.mode === "Remote" && !j.remote) adj -= 0.35;
    if (p.mode === "On-site" || p.mode === "Hybrid") {
      const jl = j.location.toLowerCase();
      if (locToks.length && locToks.some(t => jl.includes(t))) adj += 0.15;
      else if (locToks.length && !j.remote) adj -= 0.2;
    }
    const age = (Date.now() - Date.parse(j.posted)) / 864e5;
    if (age > 30) adj -= Math.min(0.15, (age - 30) / 600);
    const jobText = (j.title + " " + j.description + " " + (j.tags || []).join(" ")).toLowerCase();
    const hits = resumeKeys.filter(k => k.length > 2 && !WEAK.test(k) && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(jobText));
    // prefer phrases, and drop single words already covered by a matched phrase
    const phrases = hits.filter(k => k.includes(" "));
    const matched = [...phrases, ...hits.filter(k => !k.includes(" ") && !phrases.some(ph => ph.split(" ").includes(k)))].slice(0, 8);
    return { j, cos, titleHit, adj, matched };
  });
  const maxCos = Math.max(0.0001, ...scored.map(s => s.cos));
  return scored.map(s => {
    const raw = 0.6 * (s.cos / maxCos) + 0.4 * s.titleHit + s.adj;
    return { ...s.j, score: Math.max(1, Math.min(99, Math.round(raw * 100))), matched: s.matched };
  }).sort((a, b) => b.score - a.score);
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    if (!j.title || !j.url) return false;
    const k = (j.title + "|" + j.company).toLowerCase().replace(/\W+/g, "");
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

// ---------- optional Claude re-ranking ----------
async function aiRerank(top, p) {
  const postings = top.map(j => `ID: ${j.id}\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}\nSalary: ${j.salary || "n/a"}\n${j.description.slice(0, 900)}`).join("\n\n---\n\n");
  const prompt = `You are an expert recruiter. Rate how well each job posting fits this candidate. Be strict: a great fit needs the right function, seniority and skills.

CANDIDATE
Target role: ${p.role}\nSeniority: ${p.level}\nWork style: ${p.mode}\nLocation: ${p.location || "any"}\nMinimum salary: ${p.salary || "n/a"}
Resume:
${(p.resume || "").slice(0, 8000)}

POSTINGS
${postings}

Reply with ONLY a JSON array, one object per posting: [{"id": "...", "score": 0-100, "reason": "one sentence naming the specific overlap or the main gap"}]`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("Claude API " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const text = (d.content || []).map(c => c.text || "").join("");
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  const byId = new Map(arr.map(x => [x.id, x]));
  return top.map(j => { const a = byId.get(j.id); return a ? { ...j, score: Math.round(a.score), reason: a.reason, ai: true } : j; })
    .sort((a, b) => b.score - a.score);
}

// ---------- HTTP ----------
async function search(p) {
  const q = buildQuery(p);
  const names = Object.keys(SOURCES);
  const results = await Promise.allSettled(names.map(n => SOURCES[n](q)));
  const sources = names.map((n, i) => ({ name: n, ok: results[i].status === "fulfilled", count: results[i].value?.length || 0 }));
  const fresh = (j) => { const t = Date.parse(j.posted); return !t || Date.now() - t < 120 * 864e5; };
  const all = dedupe(results.flatMap(r => r.status === "fulfilled" ? r.value : [])).filter(fresh);
  let ranked = rank(all, p).slice(0, 40);
  let aiError = null;
  if (API_KEY && ranked.length) {
    try { ranked = [...(await aiRerank(ranked.slice(0, 25), p)), ...ranked.slice(25)]; }
    catch (e) { aiError = e.message; }
  }
  return { jobs: ranked.map(({ description, ...j }) => ({ ...j, snippet: description.slice(0, 400) })), total: all.length, sources, ai: !!API_KEY, aiError, query: q.searchTerms };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/search") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const out = await search(JSON.parse(body || "{}"));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (req.url === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ai: !!API_KEY }));
  }
  const file = path.join(__dirname, "public", req.url === "/" ? "index.html" : path.normalize(req.url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type + "; charset=utf-8" }); res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Shortlist running at http://localhost:${PORT}  (AI ranking: ${API_KEY ? "on" : "off — set ANTHROPIC_API_KEY to enable"})`));
}
module.exports = { search, rank, buildQuery };
