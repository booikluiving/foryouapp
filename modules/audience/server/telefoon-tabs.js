"use strict";

// Bestanden van de tabs naast de chat op de publiekstelefoon (public/tabs/<naam>.js).
// Alleen platte .js-namen; de telefoon vraagt ze op met ?v=<serverversie>, dus ze mogen even bewaard worden.

const path = require("node:path");

function serveerTabs(express, publicDir) {
  // AUDIENCE_TABS_DIR: andere map, voor tests en de proefshow.
  const map = process.env.AUDIENCE_TABS_DIR || path.join(publicDir, "tabs");
  const statisch = express.static(map, {
    fallthrough: false,
    index: false,
    dotfiles: "deny",
    setHeaders(res) {
      res.set("Cache-Control", "public, max-age=300");
      res.set("X-Content-Type-Options", "nosniff");
    },
  });
  return (req, res, next) => {
    if (!/^\/[a-z0-9-]+\.js$/.test(req.path)) {
      res.status(404).type("text").send("Niet gevonden");
      return;
    }
    statisch(req, res, next);
  };
}

module.exports = { serveerTabs };
