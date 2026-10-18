#!/bin/sh
set -eu
cat /etc/os-release
node --version
node dist/scripts/migrate.js
npm run test:coverage
node dist/scripts/load.js
node dist/scripts/integrations-demo.js
