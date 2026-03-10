const path = require('path');
const home = process.env.HOME || '/root';

module.exports = {
  apps: [{
    name: 'openclaw-cmd',
    script: 'server/index.js',
    cwd: path.join(home, '.openclaw', 'workspace', 'command-center'),
    node_args: '--max-old-space-size=256',
    max_memory_restart: '400M',
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
    }
  }]
};
