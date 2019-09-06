
const axios = require("axios");
const utils = require('./utils');
const _ = require('lodash');
const fs = require('fs');

require('dotenv').config();

async function main() {
  const wanted = require('./wanted.json');
  const results = require('./results.json');
  const toFetch = _.filter(wanted, (w) => {
    return ! _.contains(_.keys(results), w);
  });
  for (const repo of toFetch) {
    const info = getAllRepoInfo(repo);
    results[repo] = info;
    fs.writeFileSync('./results.json', JSON.stringify(results, null, 2));
  }
}

async function getAllRepoInfo(repo) {
  return {};
}

main();
