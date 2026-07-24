// Vercel serverless функция-прокси к Notion.
// Ключ Notion живёт ТОЛЬКО в переменной окружения NOTION_API_KEY (не в коде, не в браузере).
// Читает страницы проектов + «Ожидания», возвращает готовый JSON для сайта.

const NOTION_VERSION = "2022-06-28";

// id страниц (сверено 24.07.2026). Порядок = порядок карточек на сайте.
const PAGES = [
  { key: "Футбологика",      id: "37913f6d8cf381cc9c7fe3b4cdb6d053" },
  { key: "Сервер Джепаров",  id: "3a713f6d8cf3815aa830e5f553676389" },
  { key: "Ивенты · GSH",     id: "37913f6d8cf381ecbc60e66acfdfe5e3" },
  { key: "CoSports",         id: "37913f6d8cf381ce9f3bd1127172d1f5" },
  { key: "Карьера",          id: "37d13f6d8cf381c89716fc76c3436cec" },
  { key: "Овощебаза",        id: "3a713f6d8cf38161b550f018654a2a88" },
  { key: "Финансы",          id: "37a13f6d8cf381af9cced6dc53e88366" },
  { key: "Личное",           id: "8fc87d2201cd43e1b98733326c8e5584" },
];

const GOAL_HEADING = "цель на август";

function plain(rich) {
  return (rich || []).map(r => r.plain_text || "").join("").trim();
}

async function listBlocks(pageId, token) {
  let out = [], cursor = undefined;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
    });
    if (!r.ok) throw new Error(`Notion ${r.status} для ${pageId}`);
    const j = await r.json();
    out = out.concat(j.results || []);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

function blockText(b) {
  const t = b.type;
  const node = b[t];
  if (node && node.rich_text) return plain(node.rich_text);
  return "";
}

// парсинг одной страницы проекта: цели (to_do) + даты активности (из журнала «📝 DD.MM.YYYY»)
function parseProject(blocks) {
  let inGoal = false, done = 0, total = 0;
  const open = [];
  const tasks = [];
  const activity = [];
  const dateRe = /(\d{2})\.(\d{2})\.(\d{4})/;
  const pctRe = /[\s—·-]*(\d{1,3})\s*%\s*$/; // «— 40%» в конце текста задачи

  for (const b of blocks) {
    const t = b.type;
    if (t === "heading_1" || t === "heading_2" || t === "heading_3") {
      const txt = blockText(b);
      if (txt.toLowerCase().includes(GOAL_HEADING)) { inGoal = true; continue; }
      if (inGoal) inGoal = false;
      // журнальная запись «📝 DD.MM.YYYY»
      if (txt.includes("📝")) {
        const m = txt.match(dateRe);
        if (m) activity.push(`${m[3]}-${m[2]}-${m[1]}`);
      }
      continue;
    }
    if (inGoal && t === "divider") { inGoal = false; continue; }
    if (inGoal && t === "to_do") {
      total++;
      const checked = !!b.to_do.checked;
      let label = plain(b.to_do.rich_text);
      const m = label.match(pctRe);
      let pct = checked ? 100 : (m ? Math.min(100, +m[1]) : 0);
      if (m) label = label.replace(pctRe, "").trim();
      if (checked) done++; else open.push(label);
      tasks.push({ label, checked, pct });
      continue;
    }
    // журнальные записи иногда идут как параграфы
    const txt = blockText(b);
    if (txt.includes("📝")) {
      const m = txt.match(dateRe);
      if (m) activity.push(`${m[3]}-${m[2]}-${m[1]}`);
    }
  }
  return { done, total, open, tasks, activity };
}

export default async function handler(req, res) {
  const token = process.env.NOTION_API_KEY;
  if (!token) { res.status(500).json({ error: "NOTION_API_KEY не задан в переменных Vercel" }); return; }
  try {
    const projects = {};
    for (const p of PAGES) {
      const blocks = await listBlocks(p.id, token);
      projects[p.key] = parseProject(blocks);
    }
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      today: new Date().toISOString().slice(0, 10),
      projects,
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
