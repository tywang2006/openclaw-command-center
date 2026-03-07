module.exports = {
  apps: [{
    name: 'openclaw-cmd',
    script: 'server/index.js',
    cwd: '/root/.openclaw/workspace/command-center',
    node_args: '--max-old-space-size=256',
    max_memory_restart: '400M',
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
      OPENCLAW_AUTH_TOKEN: '231f8798242b198b234e1b384c370d234db76ffc1d7bc043',
      TELEGRAM_BOT_TOKEN: '8102890327:AAGMn9Ft2GA2T2ODOuZWDFqs1kI2BN6HWwc',
      TELEGRAM_GROUP_ID: '-1003570960670'
    }
  }]
};
