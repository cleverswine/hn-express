'use strict';

const path = require('node:path');
const express = require('express');
const db = require('db');
const { renderPage } = require('./render');
const { log } = require('./lib/log');

const PORT = Number(process.env.PORT) || 3000;
const HN_FRONTPAGE_SIZE = Number(process.env.HN_FRONTPAGE_SIZE) || 30;

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const stories = db.getFrontPage(HN_FRONTPAGE_SIZE);
  res.type('html').send(renderPage(stories));
});

app.listen(PORT, () => {
  log(`[web] listening on http://localhost:${PORT}`);
});
