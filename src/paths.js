const path = require('path');

// settings, match state and GEM session live here. Tests override DATA_DIR.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = { DATA_DIR };
