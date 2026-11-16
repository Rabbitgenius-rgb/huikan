'use strict';
// Codex is a parked adapter. Packaged builds replace this with a fixed profile.
module.exports = Object.freeze({ codexEnabled: process.env.HUIKAN_ENABLE_CODEX === '1' });
