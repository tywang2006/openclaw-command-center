module.exports = {
  apps: [{
    name: 'openclaw-cmd',
    script: 'server/index.js',
    cwd: '/root/.openclaw/workspace/command-center',
    node_args: '--max-old-space-size=180',
    max_memory_restart: '200M',
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
