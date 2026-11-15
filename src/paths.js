const path = require('path');

// Where settings, the match state and the GEM session are kept. DATA_DIR lets
// the tests (or an unusual install) point somewhere else.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = { DATA_DIR };
