import { readFile, writeFile } from 'node:fs/promises';
const url = new URL('../index.html', import.meta.url);
let html = await readFile(url, 'utf8');
const engine = await readFile(new URL('../lib/route-engine.js', import.meta.url), 'utf8');
html = html.replace(/<script id="routing-code">[\s\S]*?<\/script>/, () => `<script id="routing-code">\n${engine}\n  </script>`);
for (const [name, marker] of [['planner-ui.js','PLANNER UI'], ['recognition-ui.js','RECOGNITION UI']]) {
  const code = (await readFile(new URL('../lib/' + name, import.meta.url), 'utf8')).trimEnd();
  html = html.replace(new RegExp('    // BEGIN ' + marker + '[\\s\\S]*?    // END ' + marker), () => code);
}
await writeFile(url, html);
