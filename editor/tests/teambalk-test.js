"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createTeambalk, isPageVisit, versionPageFiles } = require("../server/app");

const PAGE = "<!doctype html><html><head><title>Catalogus</title></head><body class=\"fy-page\"><main>inhoud</main></body></html>";
const FIXTURE = path.join(__dirname, "fixtures", "teambalk");

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teambalk-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const quiet = process.stderr.write.bind(process.stderr);
const logged = [];
process.stderr.write = (text) => { logged.push(String(text)); return true; };
try {
  // Without a folder, or with an empty one, the page stays exactly as it was.
  assert.equal(createTeambalk()(PAGE, "booi@proef.nl"), PAGE);
  assert.equal(createTeambalk({ dir: folder({}) })(PAGE, "booi@proef.nl"), PAGE);
  assert.ok(logged.some((line) => line.includes("geen balk")));

  // With the bar: the style last in <head>, the script first in <body>, the first name from the list.
  const names = folder({ "namen.json": JSON.stringify({ "Booi@Proef.nl": "Booi", "x@proef.nl": "<Fien & \"co\">" }) });
  const add = createTeambalk({ dir: FIXTURE, namesFile: path.join(names, "namen.json") });
  const html = add(PAGE, "booi@proef.nl");
  assert.match(html, /<style id="fy-balk-css">[\s\S]*\.fy-balk[\s\S]*<\/style><\/head>/);
  assert.match(html, /<body class="fy-page"><script id="fy-balk-js" data-plek="voorstelling" data-naam="Booi">/);
  assert.equal((html.match(/id="fy-balk-js"/g) || []).length, 1);

  // A name is escaped; an unknown address gets no name, never the address itself.
  assert.match(add(PAGE, "x@proef.nl"), /data-naam="&lt;Fien &amp; &quot;co&quot;&gt;"/);
  const stranger = add(PAGE, "onbekend@proef.nl");
  assert.ok(stranger.includes('data-plek="voorstelling">') && !stranger.includes("onbekend@"));

  // A "$" in the bar's code is copied as is.
  const dollars = createTeambalk({ dir: folder({ "balk.js": "var a = '$&$1';", "balk.css": ".fy-balk{}" }) });
  assert.ok(dollars(PAGE, "").includes("var a = '$&$1';"));

  // A closing tag inside the bar (the real balk.js has one in a comment) is written so it cannot end the block.
  const closing = createTeambalk({ dir: folder({ "balk.js": "/* <script src=x></script> */ x('</SCRIPT><!--')", "balk.css": "/* </style> */" }) })(PAGE, "");
  assert.ok(closing.includes("/* <script src=x><\\/script> */ x('<\\/SCRIPT><\\!--')") && closing.includes("/* <\\/style> */"));
  assert.equal((closing.match(/<\/script>/gi) || []).length, 1);
  assert.equal((closing.match(/<\/style>/gi) || []).length, 1);

  // Only a page the browser opens itself (9.7): not in an iframe, not for a script.
  const visit = (headers) => isPageVisit({ headers });
  assert.equal(visit({ "sec-fetch-dest": "document", accept: "text/html" }), true);
  assert.equal(visit({ accept: "text/html,application/xhtml+xml" }), true);
  assert.equal(visit({ "sec-fetch-dest": "iframe", accept: "text/html" }), false);
  assert.equal(visit({ "sec-fetch-dest": "empty", accept: "*/*" }), false);
  assert.equal(visit({ "sec-fetch-dest": "document", "x-requested-with": "XMLHttpRequest" }), false);
  assert.equal(visit({ accept: "*/*" }), false);

  // A page's own scripts and styles get the deploy's version (Cloudflare lets browsers keep them for 4 hours).
  const page = versionPageFiles([
    '<link rel="stylesheet" href="/shared/ui/foryou.css">',
    "<script src='versies.js'></script>",
    '<script src="/universe/app.js?v=app-integrated-1"></script>',
    '<link rel="icon" href="/favicons/paden.svg">',
    '<script src="/_editor/balk.js?v=abc"></script>',
    '<script src="https://cdn.example/x.js"></script><script src="//cdn.example/y.js"></script>',
  ].join(""));
  const version = (page.match(/foryou\.css\?v=([0-9a-f]{10})"/) || [])[1];
  assert.ok(version, page);
  assert.ok(page.includes(`'versies.js?v=${version}'`));
  assert.ok(page.includes(`/universe/app.js?v=app-integrated-1&v=${version}"`));
  assert.ok(page.includes('href="/favicons/paden.svg"') && page.includes('/_editor/balk.js?v=abc"'));
  assert.ok(page.includes('"https://cdn.example/x.js"') && page.includes('"//cdn.example/y.js"'));
} finally {
  process.stderr.write = quiet;
}
console.log("teambalk: 21 controles OK");
