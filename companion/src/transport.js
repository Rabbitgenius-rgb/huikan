'use strict';
let transport;
try { transport = require('./private-rpc.cjs'); }
catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND' || !e.message.includes("'./private-rpc.cjs'")) throw e;
  transport = require('../../shared/private-rpc.cjs');
}
module.exports = transport;
