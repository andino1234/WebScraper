'use strict';

const list = [
  require('./worldbank'),
  require('./idb'),
  require('./ungm'),
  require('./pncp'),
  require('./grantsgov'),
  require('./samgov'),
  require('./html'),
  require('./rss')
];

const connectors = Object.fromEntries(list.map(c => [c.id, c]));

const CONNECTOR_OPTIONS = list.map(c => ({ id: c.id, label: c.label }));

module.exports = { connectors, CONNECTOR_OPTIONS };
