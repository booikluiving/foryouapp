#!/usr/bin/env node
"use strict";

// Registratie met de hand: node modules/show-control/tools/registratie.js start | stop | status
// Praat met show control, zodat de stand op één plek staat.

const basis = String(process.env.SHOW_CONTROL_URL || "http://127.0.0.1:3025").replace(/\/+$/, "");
const wat = process.argv[2] || "status";
const route = wat === "start" || wat === "stop" ? `/v0/show-control/registratie/${wat}` : "/v0/show-control/registratie";

fetch(basis + route, { method: route.endsWith("registratie") ? "GET" : "POST", headers: { "content-type": "application/json" }, body: route.endsWith("registratie") ? undefined : "{}" })
  .then((antwoord) => antwoord.json())
  .then((uitkomst) => {
    console.log(JSON.stringify(uitkomst, null, 2));
    process.exit(uitkomst.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(`show control niet bereikbaar op ${basis}: ${err.message}`);
    process.exit(1);
  });
