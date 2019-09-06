
const utils = require('./utils');

async function main() {
  const res = await utils.extractData('.');
  console.log(res);
}

main();
