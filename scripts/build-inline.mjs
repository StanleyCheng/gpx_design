import { readFile, writeFile } from 'node:fs/promises';
const url = new URL('../index.html', import.meta.url);
let html = await readFile(url, 'utf8');
const engine = await readFile(new URL('../lib/route-engine.js', import.meta.url), 'utf8');
const enginePattern = /<script id="routing-code">[\s\S]*?<\/script>/;
if (!enginePattern.test(html)) throw new Error('The routing-code build marker is missing.');
html = html.replace(enginePattern, () => `<script id="routing-code">\n${engine}\n  </script>`);
for (const [name, marker] of [['stage-ui.js','STAGE UI'], ['planner-ui.js','PLANNER UI'], ['recognition-ui.js','RECOGNITION UI'], ['guidance-ui.js','GUIDANCE UI']]) {
  const code = (await readFile(new URL('../lib/' + name, import.meta.url), 'utf8')).trimEnd();
  const pattern = new RegExp('[ \\t]*// BEGIN ' + marker + '[\\s\\S]*?[ \\t]*// END ' + marker);
  if (!pattern.test(html)) throw new Error(`The ${marker} build markers are missing.`);
  html = html.replace(pattern, () => code);
}
await writeFile(url, html);
