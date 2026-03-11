#!/usr/bin/env node
/**
 * ChaoClaw Command Center — CLI Entry Point
 *
 * Usage:
 *   chaoclaw-cmd start   — Start the server (first run auto-triggers setup)
 *   chaoclaw-cmd setup   — Interactive setup (language, password, layout)
 *   chaoclaw-cmd stop    — Stop PM2 process
 *   chaoclaw-cmd status  — Show service status
 */

import { execSync, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_DIR = path.resolve(__dirname, '..');
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw');
const CMD_DIR = path.join(OPENCLAW_HOME, 'workspace', 'command-center');
const CMD_PORT = process.env.CMD_PORT || '5100';
const PM2_NAME = 'openclaw-cmd';

const TEAL = '\x1b[38;5;43m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const log = (msg) => console.log(`  ${GREEN}[OK]${NC} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}[!!]${NC} ${msg}`);
const err = (msg) => { console.log(`  ${RED}[XX]${NC} ${msg}`); process.exit(1); };
const info = (msg) => console.log(`  ${CYAN}[ii]${NC} ${msg}`);

// i18n
const msgs = {
  zh: {
    title: 'ChaoClaw 指挥中心',
    copying: '正在安装文件...',
    password_prompt: '设置访问密码（最少6位，留空使用默认: chaoclaw）',
    password_confirm: '确认密码',
    password_mismatch: '两次密码不一致，使用默认密码',
    password_ok: '密码已设置',
    password_keep: '保留已有密码',
    env_create: '创建配置文件...',
    layout_gen: '生成办公室布局...',
    starting: '启动服务...',
    stopping: '停止服务...',
    done: '完成！',
    url: '访问地址',
    password_label: '密码',
    status_running: '服务运行中',
    status_stopped: '服务未运行',
  },
  en: {
    title: 'ChaoClaw Command Center',
    copying: 'Installing files...',
    password_prompt: 'Set access password (min 6 chars, empty for default: chaoclaw)',
    password_confirm: 'Confirm password',
    password_mismatch: 'Passwords don\'t match, using default',
    password_ok: 'Password set',
    password_keep: 'Keeping existing password',
    env_create: 'Creating configuration...',
    layout_gen: 'Generating office layout...',
    starting: 'Starting service...',
    stopping: 'Stopping service...',
    done: 'Done!',
    url: 'Access URL',
    password_label: 'Password',
    status_running: 'Service is running',
    status_stopped: 'Service is not running',
  },
};

let lang = 'en';
const t = (key) => (msgs[lang] && msgs[lang][key]) || key;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function hasPm2() {
  try { execSync('pm2 -v', { stdio: 'ignore' }); return true; } catch { return false; }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function banner() {
  console.log(`
${TEAL}${BOLD}    ____ _                  ____ _
   / ___| |__   __ _  ___ / ___| | __ ___      __
  | |   | '_ \\ / _\` |/ _ \\ |   | |/ _\` \\ \\ /\\ / /
  | |___| | | | (_| | (_) | |___| | (_| |\\ V  V /
   \\____|_| |_|\\__,_|\\___/ \\____|_|\\__,_| \\_/\\_/${NC}
`);
}

async function selectLang() {
  console.log(`  ${BOLD}Select Language / 请选择语言${NC}`);
  console.log('');
  console.log(`    ${TEAL}1)${NC} 中文`);
  console.log(`    ${TEAL}2)${NC} English`);
  console.log('');
  const lc = await ask('  [1/2]: ');
  lang = (lc === '2' || lc === 'en') ? 'en' : 'zh';
}

async function setup() {
  banner();
  await selectLang();

  console.log(`  ${DIM}${t('title')}${NC}`);
  console.log(`  ${DIM}${'─'.repeat(50)}${NC}`);
  console.log('');

  // Install files
  info(t('copying'));
  fs.mkdirSync(CMD_DIR, { recursive: true });

  const items = ['server', 'dist', 'scripts', 'node_modules', 'package.json', 'ecosystem.config.cjs'];
  for (const item of items) {
    const src = path.join(PKG_DIR, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(CMD_DIR, item);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dst, { recursive: true, force: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  log(t('copying'));

  // Password
  let plainPw = 'chaoclaw';
  const authFile = path.join(CMD_DIR, '.auth_password');
  if (fs.existsSync(authFile)) {
    log(t('password_keep'));
  } else {
    console.log('');
    info(t('password_prompt'));
    let pw1 = await ask('  > ');
    if (!pw1 || pw1.length < 6) {
      pw1 = 'chaoclaw';
    } else {
      const pw2 = await ask(`  ${t('password_confirm')}: `);
      if (pw1 !== pw2) { warn(t('password_mismatch')); pw1 = 'chaoclaw'; }
    }
    plainPw = pw1;
    fs.writeFileSync(authFile, hashPassword(pw1));
    log(t('password_ok'));
  }

  // .env
  info(t('env_create'));
  let ocToken = '';
  const ocConfig = path.join(OPENCLAW_HOME, 'openclaw.json');
  if (fs.existsSync(ocConfig)) {
    try {
      const c = JSON.parse(fs.readFileSync(ocConfig, 'utf8'));
      ocToken = c.authToken || c.token || (c.auth && c.auth.token) || (c.gateway && c.gateway.auth && c.gateway.auth.token) || '';
    } catch {}
  }
  const envPath = path.join(CMD_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `OPENCLAW_HOME=${OPENCLAW_HOME}\nCMD_PORT=${CMD_PORT}\nOPENCLAW_AUTH_TOKEN=${ocToken}\n`);
  }
  log('.env');

  // Layout
  info(t('layout_gen'));
  const genLayout = path.join(CMD_DIR, 'scripts', 'gen-layout.js');
  if (fs.existsSync(genLayout)) {
    try { execSync(`node "${genLayout}"`, { stdio: 'ignore' }); } catch {}
  }

  // Mark setup done
  fs.writeFileSync(path.join(CMD_DIR, '.setup-done'), '');
  log(t('done'));

  return plainPw;
}

async function start() {
  let plainPw = 'chaoclaw';
  const setupDone = path.join(CMD_DIR, '.setup-done');
  if (!fs.existsSync(setupDone)) {
    plainPw = await setup();
  }

  if (!hasPm2()) {
    info('Installing pm2...');
    execSync('npm install -g pm2', { stdio: 'inherit' });
  }

  info(t('starting'));
  try { execSync(`pm2 delete ${PM2_NAME}`, { stdio: 'ignore' }); } catch {}

  const eco = path.join(CMD_DIR, 'ecosystem.config.cjs');
  if (fs.existsSync(eco)) {
    execSync(`pm2 start "${eco}"`, { cwd: CMD_DIR, stdio: 'inherit' });
  } else {
    execSync(`pm2 start server/index.js --name "${PM2_NAME}"`, { cwd: CMD_DIR, stdio: 'inherit' });
  }
  execSync('pm2 save', { stdio: 'ignore' });

  // Wait & print info
  await new Promise(r => setTimeout(r, 3000));

  console.log('');
  console.log(`  ${TEAL}${BOLD}${'━'.repeat(50)}${NC}`);
  console.log(`  ${TEAL}${BOLD}  ${t('done')}${NC}`);
  console.log(`  ${TEAL}${BOLD}${'━'.repeat(50)}${NC}`);
  console.log('');
  console.log(`  ${BOLD}${t('url')}:${NC}  ${GREEN}http://localhost:${CMD_PORT}/cmd/${NC}`);
  console.log(`  ${BOLD}${t('password_label')}:${NC}  ${CYAN}${plainPw}${NC}`);
  console.log('');
}

function stop() {
  if (!hasPm2()) { warn('pm2 not installed'); return; }
  info(t('stopping'));
  try { execSync(`pm2 stop ${PM2_NAME}`, { stdio: 'inherit' }); } catch {}
}

function status() {
  if (!hasPm2()) { warn('pm2 not installed'); return; }
  try {
    const out = execSync(`pm2 jlist`, { encoding: 'utf8' });
    const procs = JSON.parse(out);
    const proc = procs.find(p => p.name === PM2_NAME);
    if (proc && proc.pm2_env && proc.pm2_env.status === 'online') {
      log(`${t('status_running')} (pid: ${proc.pid}, port: ${CMD_PORT})`);
      console.log(`  ${BOLD}${t('url')}:${NC}  http://localhost:${CMD_PORT}/cmd/`);
    } else {
      warn(t('status_stopped'));
    }
  } catch {
    warn(t('status_stopped'));
  }
}

// Main
const command = process.argv[2] || 'start';
switch (command) {
  case 'start':  await start(); break;
  case 'setup':  await setup(); break;
  case 'stop':   stop(); break;
  case 'status': status(); break;
  default:
    console.log(`Usage: chaoclaw-cmd <start|setup|stop|status>`);
    console.log('');
    console.log('  start   Start the server (runs setup on first use)');
    console.log('  setup   Interactive configuration');
    console.log('  stop    Stop the PM2 process');
    console.log('  status  Show service status');
    process.exit(1);
}
