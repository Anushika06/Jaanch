// Render selected docs/*.md to standalone HTML pages (same content, readable offline in a
// browser; Mermaid diagrams render client-side). Run: pnpm docs:html
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['product-explainer', 'architecture', 'user-workflow', 'demo-video-script'];

const renderer = new marked.Renderer();
const baseCode = renderer.code.bind(renderer);
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
renderer.code = (token) =>
  token.lang === 'mermaid'
    ? `<pre class="mermaid">${escapeHtml(token.text)}</pre>`
    : baseCode(token);
// Links between docs point at the HTML versions when one exists.
const baseLink = renderer.link.bind(renderer);
renderer.link = (token) => {
  const href = token.href.replace(/^([\w-]+)\.md(#.*)?$/, (m, name, hash = '') =>
    docs.includes(name) ? `${name}.html${hash}` : m,
  );
  return baseLink({ ...token, href });
};

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Jaanch</title>
<style>
  :root { --paper:#f1f4f2; --ink:#18202e; --ink2:#47526a; --rule:#d3dce4; --neel:#22306e; --surface:#fff; }
  @media (prefers-color-scheme: dark) { :root { --paper:#0f1420; --ink:#e8ecf3; --ink2:#a9b3c6; --rule:#2a3346; --neel:#9fb0ff; --surface:#161d2b; } }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.6 system-ui, 'Noto Sans', 'Noto Sans Devanagari', sans-serif; }
  main { max-width:52rem; margin:0 auto; padding:2rem 1rem 4rem; }
  h1 { color:var(--neel); font-size:2.2rem; line-height:1.1; }
  h2 { margin-top:2.4rem; border-top:2px solid var(--ink); padding-top:.8rem; }
  a { color:var(--neel); }
  table { border-collapse:collapse; width:100%; font-size:.95rem; display:block; overflow-x:auto; }
  th, td { border-bottom:1px solid var(--rule); padding:.5rem .45rem; text-align:left; vertical-align:top; }
  th { color:var(--ink2); }
  code { background:rgba(127,127,127,.15); padding:.05em .3em; border-radius:4px; font-size:.9em; }
  pre { background:var(--surface); border:1px solid var(--rule); border-radius:8px; padding:.9rem; overflow-x:auto; }
  pre code { background:none; padding:0; }
  pre.mermaid { background:var(--surface); text-align:center; }
  blockquote { margin:1rem 0; padding:.6rem 1rem; border-left:4px solid var(--neel); background:var(--surface); }
  .back { font-size:.95rem; }
</style>
</head>
<body>
<main>
<p class="back"><a href="../README.md">Jaanch</a> · documentation</p>
${body}
</main>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'neutral' });
</script>
</body>
</html>
`;

for (const name of docs) {
  const md = readFileSync(path.join(root, 'docs', `${name}.md`), 'utf8');
  const title = /^#\s+(.+)$/m.exec(md)?.[1] ?? name;
  const html = marked.parse(md, { renderer, gfm: true });
  writeFileSync(path.join(root, 'docs', `${name}.html`), page(title.replace(/[<>]/g, ''), html));
  console.log(`docs/${name}.html`);
}
