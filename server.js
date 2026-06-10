require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { ethers } = require('ethers');
const { updatePassportMetadataOnGitHub } = require("./services/githubMetadata.service");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());

const db = new sqlite3.Database(path.join(__dirname, 'productivity.db'));
const loginNonces = new Map();
const sessions = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function getAdminWallets() {
  return String(process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(normalizeAddress)
    .filter(Boolean);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => {
        const idx = v.indexOf('=');
        return idx === -1 ? [v, ''] : [v.slice(0, idx), decodeURIComponent(v.slice(idx + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

async function resolveUserByAddress(address) {
  const normalized = normalizeAddress(address);
  const adminWallets = getAdminWallets();

  if (adminWallets.includes(normalized)) {
    return { address: normalized, role: 'admin', employee: null };
  }

  const employee = await get(
    `SELECT * FROM employees WHERE lower(wallet) = lower(?) LIMIT 1`,
    [normalized]
  );

  if (employee) {
    if (employee.status === 'pending') {
      return { address: normalized, role: 'pending', employee };
    }
    if (employee.status === 'blocked') {
      return { address: normalized, role: 'blocked', employee };
    }
    return { address: normalized, role: 'user', employee };
  }

  return null;
}

async function optionalAuth(req, res, next) {
  try {
    const token = parseCookies(req).session;
    const session = token ? sessions.get(token) : null;
    if (!session) return next();

    const user = await resolveUserByAddress(session.address);
    if (!user) {
      sessions.delete(token);
      return next();
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function wantsHtml(req) {
  return String(req.headers.accept || '').includes('text/html');
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsHtml(req)) return res.redirect('/login.html');
  return res.status(401).json({ status: 'error', message: 'Потрібна авторизація через MetaMask' });
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (wantsHtml(req)) return res.status(403).send('<h1>403</h1><p>Панель керівника доступна тільки адміністратору. <a href="/login.html">Увійти іншим гаманцем</a></p>');
  return res.status(403).json({ status: 'error', message: 'Доступ дозволено тільки адміністратору' });
}

function canAccessEmployee(req, employeeId) {
  if (req.user?.role === 'admin') return true;
  return Number(req.user?.employee?.tokenId) === Number(employeeId);
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS employees (
    tokenId INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    wallet TEXT,
    avatar TEXT,
    grade TEXT DEFAULT 'Junior',
    status TEXT DEFAULT 'active',
    registrationNote TEXT,
    registeredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    approvedAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const columns = await all(`PRAGMA table_info(employees)`);
  if (!columns.some(c => c.name === 'wallet')) {
    await run(`ALTER TABLE employees ADD COLUMN wallet TEXT`);
  }
  if (!columns.some(c => c.name === 'avatar')) {
    await run(`ALTER TABLE employees ADD COLUMN avatar TEXT`);
  }
  if (!columns.some(c => c.name === 'grade')) {
    await run(`ALTER TABLE employees ADD COLUMN grade TEXT DEFAULT 'Junior'`);
  }
  if (!columns.some(c => c.name === 'status')) {
    await run(`ALTER TABLE employees ADD COLUMN status TEXT DEFAULT 'active'`);
  }
  if (!columns.some(c => c.name === 'registrationNote')) {
    await run(`ALTER TABLE employees ADD COLUMN registrationNote TEXT`);
  }
  if (!columns.some(c => c.name === 'registeredAt')) {
    await run(`ALTER TABLE employees ADD COLUMN registeredAt DATETIME`);
  }
  if (!columns.some(c => c.name === 'approvedAt')) {
    await run(`ALTER TABLE employees ADD COLUMN approvedAt DATETIME`);
  }

  await run(`UPDATE employees SET status = 'active' WHERE status IS NULL OR status = ''`);
  await run(`UPDATE employees SET grade = 'Junior' WHERE grade IS NULL OR grade = ''`);
  await run(`UPDATE employees SET registeredAt = COALESCE(registeredAt, createdAt, CURRENT_TIMESTAMP)`);

  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actorWallet TEXT,
    action TEXT NOT NULL,
    targetType TEXT,
    targetId TEXT,
    details TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS performance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    taskTitle TEXT NOT NULL,
    taskCategory TEXT NOT NULL,
    earnedPoints INTEGER NOT NULL,
    taskComplexity INTEGER NOT NULL,
    qualityScore INTEGER NOT NULL,
    missedDeadline INTEGER NOT NULL DEFAULT 0,
    reliabilityScore INTEGER NOT NULL,
    streakBonus INTEGER NOT NULL DEFAULT 0,
    transactionHash TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(employeeId) REFERENCES employees(tokenId)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS learning_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL,
    skillTag TEXT NOT NULL,
    level TEXT DEFAULT 'Beginner',
    reason TEXT,
    UNIQUE(title, provider)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS employee_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    taskId INTEGER,
    resourceId INTEGER NOT NULL,
    type TEXT DEFAULT 'info',
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME,
    FOREIGN KEY(employeeId) REFERENCES employees(tokenId),
    FOREIGN KEY(taskId) REFERENCES performance_history(id),
    FOREIGN KEY(resourceId) REFERENCES learning_resources(id)
  )`);


  const learningColumns = await all(`PRAGMA table_info(learning_resources)`);
  if (!learningColumns.some(c => c.name === 'triggerType')) {
    await run(`ALTER TABLE learning_resources ADD COLUMN triggerType TEXT DEFAULT 'general'`);
  }
  if (!learningColumns.some(c => c.name === 'incentiveType')) {
    await run(`ALTER TABLE learning_resources ADD COLUMN incentiveType TEXT DEFAULT 'development'`);
  }

  const recommendationColumns = await all(`PRAGMA table_info(employee_recommendations)`);
  if (!recommendationColumns.some(c => c.name === 'priority')) {
    await run(`ALTER TABLE employee_recommendations ADD COLUMN priority TEXT DEFAULT 'medium'`);
  }
  if (!recommendationColumns.some(c => c.name === 'skillGap')) {
    await run(`ALTER TABLE employee_recommendations ADD COLUMN skillGap TEXT`);
  }
  if (!recommendationColumns.some(c => c.name === 'expectedOutcome')) {
    await run(`ALTER TABLE employee_recommendations ADD COLUMN expectedOutcome TEXT`);
  }

  await seedLearningResources();

  const count = await get(`SELECT COUNT(*) as total FROM employees`);
  if (count.total === 0) {
    await run(`INSERT INTO employees (tokenId, name, role, avatar, grade, status, approvedAt) VALUES
      (0, 'Ілля', 'Frontend Developer', '💻', 'Junior', 'active', CURRENT_TIMESTAMP),
      (1, 'Олександр', 'Backend Developer', '🛠️', 'Middle', 'active', CURRENT_TIMESTAMP),
      (2, 'Марія', 'QA Engineer', '🧪', 'Junior', 'active', CURRENT_TIMESTAMP)`);
  }
}

function isBlockchainConfigured() {
  return Boolean(process.env.RPC_URL && process.env.PRIVATE_KEY && process.env.CONTRACT_ADDRESS);
}

function getContract() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = [
    'function updateReputation(uint256 tokenId, uint256 addedPoints, uint256 newReliabilityScore) public',
    'function employeeReputation(uint256) view returns (uint256 totalPoints, uint256 tasksCompleted, uint256 reliabilityScore)'
  ];
  return new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
}
function getReadOnlyPassportContract() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

  const abi = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function passportExists(uint256 tokenId) view returns (bool)',
    'function employeeReputation(uint256 tokenId) view returns (uint256 totalPoints, uint256 tasksCompleted, uint256 reliabilityScore, uint256 currentStreak, uint256 lastUpdatedAt)'
  ];

  return new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, provider);
}
function validateTaskPayload(body) {
  const employeeTokenId = Number(body.employeeTokenId);
  const taskComplexity = Number(body.taskComplexity);
  const qualityScore = Number(body.qualityScore ?? 80);
  const taskTitle = String(body.taskTitle || '').trim();
  const taskCategory = String(body.taskCategory || 'General').trim();
  const missedDeadline = Boolean(body.missedDeadline);

  if (!Number.isInteger(employeeTokenId) || employeeTokenId < 0) throw new Error('Некоректний ID працівника');
  if (!taskTitle || taskTitle.length < 3) throw new Error('Назва задачі має містити мінімум 3 символи');
  if (!Number.isInteger(taskComplexity) || taskComplexity < 1 || taskComplexity > 5) throw new Error('Складність має бути від 1 до 5');
  if (!Number.isInteger(qualityScore) || qualityScore < 0 || qualityScore > 100) throw new Error('Якість має бути від 0 до 100');

  return { employeeTokenId, taskTitle, taskCategory, taskComplexity, qualityScore, missedDeadline };
}

async function calculateReputation(employeeId, taskComplexity, qualityScore, missedDeadline) {
  const lastTasks = await all(
    `SELECT missedDeadline, qualityScore FROM performance_history WHERE employeeId = ? ORDER BY createdAt DESC LIMIT 10`,
    [employeeId]
  );

  const basePoints = taskComplexity * 10;
  const qualityBonus = Math.round((qualityScore - 50) / 5);
  const streakBonus = lastTasks.slice(0, 2).length === 2 && lastTasks.slice(0, 2).every(t => !t.missedDeadline) ? 5 : 0;
  const deadlinePenalty = missedDeadline ? Math.round(basePoints * 0.45) : 0;
  const earnedPoints = Math.max(1, basePoints + qualityBonus + streakBonus - deadlinePenalty);

  const futureTasks = [{ missedDeadline: missedDeadline ? 1 : 0, qualityScore }, ...lastTasks].slice(0, 10);
  const missedCount = futureTasks.filter(t => Number(t.missedDeadline) === 1).length;
  const avgQuality = futureTasks.reduce((sum, t) => sum + Number(t.qualityScore || 0), 0) / futureTasks.length;
  const reliabilityScore = Math.max(0, Math.min(100, Math.round(70 + avgQuality * 0.3 - missedCount * 7)));

  return { earnedPoints, reliabilityScore, streakBonus, basePoints, qualityBonus, deadlinePenalty };
}


async function seedLearningResources() {
  const resources = [
    {
      title: 'Atlassian Agile Tutorials',
      provider: 'Atlassian',
      url: 'https://www.atlassian.com/agile/tutorials',
      category: 'Agile',
      skillTag: 'Deadline',
      level: 'Beginner',
      triggerType: 'missed_deadline',
      incentiveType: 'corrective',
      reason: 'Планування спринтів, декомпозиція задач, оцінка термінів і контроль дедлайнів.'
    },
    {
      title: 'Jira Fundamentals',
      provider: 'Atlassian University',
      url: 'https://university.atlassian.com/student/catalog/list?category_ids=21603-jira',
      category: 'Agile',
      skillTag: 'Jira',
      level: 'Beginner',
      triggerType: 'low_reliability',
      incentiveType: 'corrective',
      reason: 'Базові навички роботи із задачами, статусами, backlog та прозорим плануванням.'
    },
    {
      title: 'Review Pull Requests',
      provider: 'GitHub Skills',
      url: 'https://github.com/skills/review-pull-requests',
      category: 'Code Review',
      skillTag: 'Quality',
      level: 'Beginner',
      triggerType: 'low_quality',
      incentiveType: 'corrective',
      reason: 'Практика якісного code review, перевірки змін і зменшення кількості помилок.'
    },
    {
      title: 'Testing Web Applications',
      provider: 'MDN Web Docs',
      url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Testing',
      category: 'QA',
      skillTag: 'Testing',
      level: 'Beginner',
      triggerType: 'qa_quality',
      incentiveType: 'corrective',
      reason: 'Базові підходи до тестування вебзастосунків і перевірки якості.'
    },
    {
      title: 'JavaScript Guide',
      provider: 'MDN Web Docs',
      url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide',
      category: 'Frontend',
      skillTag: 'JavaScript',
      level: 'Beginner',
      triggerType: 'frontend_quality',
      incentiveType: 'corrective',
      reason: 'Повторення базових і середніх тем JavaScript для покращення якості frontend-задач.'
    },
    {
      title: 'React Learn',
      provider: 'React',
      url: 'https://react.dev/learn',
      category: 'Frontend',
      skillTag: 'React',
      level: 'Beginner',
      triggerType: 'frontend_quality',
      incentiveType: 'corrective',
      reason: 'Офіційний курс React для компонентів, стану, подій і структури UI.'
    },
    {
      title: 'Learn Performance',
      provider: 'web.dev',
      url: 'https://web.dev/learn/performance',
      category: 'Frontend',
      skillTag: 'Performance',
      level: 'Intermediate',
      triggerType: 'growth_high_quality',
      incentiveType: 'growth',
      reason: 'Поглиблення навичок оптимізації швидкодії вебінтерфейсів і Core Web Vitals.'
    },
    {
      title: 'Learn Node.js',
      provider: 'Node.js',
      url: 'https://nodejs.org/en/learn',
      category: 'Backend',
      skillTag: 'Node.js',
      level: 'Beginner',
      triggerType: 'backend_quality',
      incentiveType: 'corrective',
      reason: 'Офіційні матеріали Node.js для покращення backend-розробки.'
    },
    {
      title: 'Express Routing Guide',
      provider: 'Express.js',
      url: 'https://expressjs.com/en/guide/routing.html',
      category: 'Backend',
      skillTag: 'Express',
      level: 'Beginner',
      triggerType: 'backend_quality',
      incentiveType: 'corrective',
      reason: 'Маршрутизація API, middleware і структура Express-застосунків.'
    },
    {
      title: 'OWASP Top 10',
      provider: 'OWASP',
      url: 'https://owasp.org/www-project-top-ten/',
      category: 'Security',
      skillTag: 'Security',
      level: 'Beginner',
      triggerType: 'security_quality',
      incentiveType: 'corrective',
      reason: 'Основні ризики безпеки вебзастосунків і типові помилки реалізації.'
    },
    {
      title: 'Web Security Testing Guide',
      provider: 'OWASP',
      url: 'https://owasp.org/www-project-web-security-testing-guide/',
      category: 'Security',
      skillTag: 'Testing',
      level: 'Intermediate',
      triggerType: 'security_quality',
      incentiveType: 'growth',
      reason: 'Методика тестування безпеки вебзастосунків і перевірки вразливостей.'
    },
    {
      title: 'Smart Contract Security',
      provider: 'Ethereum.org',
      url: 'https://ethereum.org/en/developers/docs/smart-contracts/security/',
      category: 'Blockchain',
      skillTag: 'Solidity',
      level: 'Intermediate',
      triggerType: 'blockchain_quality',
      incentiveType: 'corrective',
      reason: 'Безпечна розробка смарт-контрактів, access control, перевірки та аудит.'
    },
    {
      title: 'Solidity by Example',
      provider: 'Solidity by Example',
      url: 'https://solidity-by-example.org/',
      category: 'Blockchain',
      skillTag: 'Solidity',
      level: 'Beginner',
      triggerType: 'blockchain_quality',
      incentiveType: 'corrective',
      reason: 'Практичні приклади Solidity для повторення синтаксису та шаблонів контрактів.'
    },
    {
      title: 'GitHub Actions',
      provider: 'GitHub Docs',
      url: 'https://docs.github.com/en/actions',
      category: 'DevOps',
      skillTag: 'CI/CD',
      level: 'Beginner',
      triggerType: 'devops_quality',
      incentiveType: 'corrective',
      reason: 'Автоматизація перевірок, збірки та деплою через GitHub Actions.'
    },
    {
      title: 'Technical Writing',
      provider: 'Google for Developers',
      url: 'https://developers.google.com/tech-writing',
      category: 'Documentation',
      skillTag: 'Documentation',
      level: 'Beginner',
      triggerType: 'documentation_quality',
      incentiveType: 'corrective',
      reason: 'Покращення технічної документації, опису задач і зрозумілості результатів.'
    },
    {
      title: 'Career Path: Software Engineer',
      provider: 'Codecademy',
      url: 'https://www.codecademy.com/catalog/subject/web-development',
      category: 'General',
      skillTag: 'Growth',
      level: 'Intermediate',
      triggerType: 'growth_high_quality',
      incentiveType: 'growth',
      reason: 'Матеріал для подальшого професійного росту після стабільно високих результатів.'
    }
  ];

  for (const r of resources) {
    await run(
      `INSERT OR IGNORE INTO learning_resources
       (title, provider, url, category, skillTag, level, reason, triggerType, incentiveType)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.title, r.provider, r.url, r.category, r.skillTag, r.level, r.reason, r.triggerType, r.incentiveType]
    );

    await run(
      `UPDATE learning_resources
       SET url = ?, category = ?, skillTag = ?, level = ?, reason = ?, triggerType = ?, incentiveType = ?
       WHERE title = ? AND provider = ?`,
      [r.url, r.category, r.skillTag, r.level, r.reason, r.triggerType, r.incentiveType, r.title, r.provider]
    );
  }
}

function detectTaskProblem(payload, scoring) {
  const category = String(payload.taskCategory || 'General');
  const quality = Number(payload.qualityScore || 0);

  if (payload.missedDeadline) {
    return {
      type: 'warning',
      priority: 'high',
      triggerType: 'missed_deadline',
      category: 'Agile',
      skillTag: 'Deadline',
      skillGap: 'Планування часу та контроль дедлайнів',
      expectedOutcome: 'Працівник краще декомпозує задачі, оцінює терміни та вчасно попереджає про ризики.',
      reason: `У задачі «${payload.taskTitle}» було зірвано дедлайн. Система не просто фіксує порушення, а пропонує матеріал з планування задач і роботи зі спринтами.`
    };
  }

  if (quality < 70) {
    return {
      type: 'warning',
      priority: 'high',
      triggerType: 'low_quality',
      category: 'Code Review',
      skillTag: 'Quality',
      skillGap: 'Якість виконання та самоперевірка',
      expectedOutcome: 'Працівник зменшує кількість помилок, краще перевіряє результат і готує роботу до review.',
      reason: `Якість задачі «${payload.taskTitle}» нижча за 70%. Рекомендовано пройти практичний матеріал з code review та перевірки якості.`
    };
  }

  if (scoring.reliabilityScore < 75) {
    return {
      type: 'warning',
      priority: 'high',
      triggerType: 'low_reliability',
      category: 'Agile',
      skillTag: 'Jira',
      skillGap: 'Стабільність виконання задач',
      expectedOutcome: 'Працівник краще працює зі статусами задач, пріоритетами та регулярністю виконання.',
      reason: `Показник надійності знизився до ${scoring.reliabilityScore}/100. Система пропонує ресурс для покращення роботи із задачами та статусами.`
    };
  }

  const categoryRules = {
    Frontend: { triggerType: 'frontend_quality', category: 'Frontend', skillTag: quality < 75 ? 'React' : 'JavaScript', skillGap: 'Якість frontend-реалізації' },
    Backend: { triggerType: 'backend_quality', category: 'Backend', skillTag: 'Node.js', skillGap: 'Якість backend/API-реалізації' },
    QA: { triggerType: 'qa_quality', category: 'QA', skillTag: 'Testing', skillGap: 'Якість тестування' },
    DevOps: { triggerType: 'devops_quality', category: 'DevOps', skillTag: 'CI/CD', skillGap: 'Автоматизація та CI/CD' },
    Documentation: { triggerType: 'documentation_quality', category: 'Documentation', skillTag: 'Documentation', skillGap: 'Якість технічної документації' },
    Blockchain: { triggerType: 'blockchain_quality', category: 'Blockchain', skillTag: 'Solidity', skillGap: 'Якість blockchain-реалізації' },
    Security: { triggerType: 'security_quality', category: 'Security', skillTag: 'Security', skillGap: 'Безпека реалізації' }
  };

  if (quality < 80 && categoryRules[category]) {
    const rule = categoryRules[category];

    return {
      type: 'info',
      priority: 'medium',
      triggerType: rule.triggerType,
      category: rule.category,
      skillTag: rule.skillTag,
      skillGap: rule.skillGap,
      expectedOutcome: 'Працівник підсилює саме той напрям, у якому була виконана задача.',
      reason: `У категорії «${category}» якість задачі «${payload.taskTitle}» можна покращити. Рекомендація підібрана не загально, а під конкретний напрям роботи.`
    };
  }

  if (!payload.missedDeadline && quality >= 90 && scoring.reliabilityScore >= 85) {
    return {
      type: 'success',
      priority: 'low',
      triggerType: 'growth_high_quality',
      category: category === 'Frontend' ? 'Frontend' : 'General',
      skillTag: category === 'Frontend' ? 'Performance' : 'Growth',
      skillGap: 'Професійне зростання після високого результату',
      expectedOutcome: 'Працівник переходить до складніших матеріалів і отримує розвиток, а не лише похвалу.',
      reason: `Задачу «${payload.taskTitle}» виконано якісно і вчасно. Система пропонує ресурс для професійного росту та переходу до складніших задач.`
    };
  }

  return {
    type: 'success',
    priority: 'low',
    triggerType: 'growth_high_quality',
    category: 'General',
    skillTag: 'Growth',
    skillGap: 'Підтримка стабільного розвитку',
    expectedOutcome: 'Працівник зберігає позитивну динаміку та бачить наступний напрям розвитку.',
    reason: `Задачу «${payload.taskTitle}» виконано без критичних проблем. Система пропонує ресурс для підтримки професійного розвитку.`
  };
}

async function findLearningResource(rule) {
  const byTriggerAndSkill = await get(
    `SELECT * FROM learning_resources
     WHERE lower(triggerType) = lower(?) AND lower(skillTag) = lower(?)
     ORDER BY id ASC
     LIMIT 1`,
    [rule.triggerType, rule.skillTag]
  );

  if (byTriggerAndSkill) return byTriggerAndSkill;

  const byTrigger = await get(
    `SELECT * FROM learning_resources
     WHERE lower(triggerType) = lower(?)
     ORDER BY id ASC
     LIMIT 1`,
    [rule.triggerType]
  );

  if (byTrigger) return byTrigger;

  const byCategoryOrSkill = await get(
    `SELECT * FROM learning_resources
     WHERE lower(category) = lower(?) OR lower(skillTag) = lower(?)
     ORDER BY CASE WHEN lower(skillTag) = lower(?) THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [rule.category, rule.skillTag, rule.skillTag]
  );

  return byCategoryOrSkill || null;
}

async function addRecommendation(employeeId, taskId, rule) {
  const resource = await findLearningResource(rule);
  if (!resource) return null;

  const duplicate = await get(
    `SELECT id FROM employee_recommendations
     WHERE employeeId = ? AND resourceId = ? AND status IN ('new', 'in_progress')
     LIMIT 1`,
    [employeeId, resource.id]
  );

  if (duplicate) return null;

  const inserted = await run(
    `INSERT INTO employee_recommendations
     (employeeId, taskId, resourceId, type, reason, priority, skillGap, expectedOutcome, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      employeeId,
      taskId,
      resource.id,
      rule.type,
      rule.reason,
      rule.priority,
      rule.skillGap,
      rule.expectedOutcome
    ]
  );

  return getRecommendationById(inserted.id);
}

async function getRecommendationById(id) {
  return get(`
    SELECT er.id, er.employeeId, er.taskId, er.type, er.reason, er.priority, er.skillGap, er.expectedOutcome,
      er.status, er.createdAt, er.updatedAt,
      lr.title, lr.provider, lr.url, lr.category, lr.skillTag, lr.level, lr.reason AS resourceReason,
      lr.triggerType, lr.incentiveType
    FROM employee_recommendations er
    JOIN learning_resources lr ON lr.id = er.resourceId
    WHERE er.id = ?`, [id]);
}

async function generateLearningRecommendations(payload, scoring, taskId) {
  const recommendations = [];

  const primaryRule = detectTaskProblem(payload, scoring);
  const primaryRec = await addRecommendation(payload.employeeTokenId, taskId, primaryRule);
  if (primaryRec) recommendations.push(primaryRec);

  // Додаткове правило: якщо є і дедлайн, і низька якість — додаємо ще ресурс з якості.
  if (payload.missedDeadline && Number(payload.qualityScore || 0) < 70) {
    const qualityRule = {
      type: 'warning',
      priority: 'high',
      triggerType: 'low_quality',
      category: 'Code Review',
      skillTag: 'Quality',
      skillGap: 'Якість виконання та самоперевірка',
      expectedOutcome: 'Працівник одночасно працює не лише над дедлайнами, а й над якістю результату.',
      reason: `Окрім зриву дедлайну, задача «${payload.taskTitle}» має низьку якість. Додано окремий ресурс для покращення code review.`
    };

    const rec = await addRecommendation(payload.employeeTokenId, taskId, qualityRule);
    if (rec) recommendations.push(rec);
  }

  // Додаткове правило: технологічний ресурс для конкретної категорії.
  const category = String(payload.taskCategory || 'General');
  const categoryRules = {
    Frontend: { triggerType: 'frontend_quality', category: 'Frontend', skillTag: 'React', skillGap: 'Frontend-навички' },
    Backend: { triggerType: 'backend_quality', category: 'Backend', skillTag: 'Node.js', skillGap: 'Backend-навички' },
    QA: { triggerType: 'qa_quality', category: 'QA', skillTag: 'Testing', skillGap: 'QA-навички' },
    DevOps: { triggerType: 'devops_quality', category: 'DevOps', skillTag: 'CI/CD', skillGap: 'DevOps-навички' },
    Blockchain: { triggerType: 'blockchain_quality', category: 'Blockchain', skillTag: 'Solidity', skillGap: 'Blockchain-навички' },
    Security: { triggerType: 'security_quality', category: 'Security', skillTag: 'Security', skillGap: 'Security-навички' }
  };

  if (Number(payload.qualityScore || 0) < 85 && categoryRules[category]) {
    const rule = {
      type: 'info',
      priority: 'medium',
      ...categoryRules[category],
      expectedOutcome: 'Працівник отримує тематичний ресурс саме під категорію задачі.',
      reason: `Для задачі «${payload.taskTitle}» у категорії «${category}» додано тематичний ресурс для підсилення професійної компетенції.`
    };

    const rec = await addRecommendation(payload.employeeTokenId, taskId, rule);
    if (rec) recommendations.push(rec);
  }

  return recommendations;
}


async function logAudit(req, action, targetType, targetId, details = {}) {
  try {
    await run(
      `INSERT INTO audit_logs (actorWallet, action, targetType, targetId, details) VALUES (?, ?, ?, ?, ?)`,
      [req.user?.address || null, action, targetType || null, targetId == null ? null : String(targetId), JSON.stringify(details)]
    );
  } catch (error) {
    console.warn('Audit log skipped:', error.message);
  }
}

app.get('/login.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.use(optionalAuth);

app.get('/admin.html', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/profile.html', requireAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'profile.html')));
app.get('/analytics.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'analytics.html'));
});
app.get('/passport.html', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'passport.html'));
});
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', (req, res) => res.redirect('/index.html'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', blockchainConfigured: isBlockchainConfigured(), network: 'Sepolia testnet' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ status: 'success', user: req.user });
});

app.post('/api/auth/nonce', async (req, res) => {
  try {
    const address = normalizeAddress(req.body.address);
    if (!ethers.utils.isAddress(address)) throw new Error('Некоректна адреса MetaMask');

    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const message = [
      'Sign in to Web3 Productivity System',
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`
    ].join('\n');

    loginNonces.set(address, { nonce, message, issuedAt, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ status: 'success', message });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const address = normalizeAddress(req.body.address);
    const signature = String(req.body.signature || '').trim();
    const nonceData = loginNonces.get(address);

    if (!nonceData) throw new Error('Спочатку потрібно отримати nonce');
    if (Date.now() > nonceData.expiresAt) throw new Error('Nonce застарів. Спробуйте увійти ще раз');

    const recovered = normalizeAddress(ethers.utils.verifyMessage(nonceData.message, signature));
    if (recovered !== address) throw new Error('Підпис не відповідає адресі гаманця');

    const user = await resolveUserByAddress(address);
    if (!user) {
      throw new Error('Цей гаманець не привʼязаний до працівника і не доданий у ADMIN_WALLETS');
    }
    if (user.role === 'pending') {
      throw new Error('Заявка цього працівника очікує підтвердження адміністратором');
    }
    if (user.role === 'blocked') {
      throw new Error('Цей профіль заблокований адміністратором');
    }

    loginNonces.delete(address);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { address, createdAt: Date.now() });
    setSessionCookie(res, token);

    res.json({ status: 'success', user });
  } catch (error) {
    res.status(401).json({ status: 'error', message: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ status: 'success' });
});

app.post('/api/register/employee', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const role = String(req.body.role || '').trim();
    const wallet = normalizeAddress(req.body.wallet);
    const grade = String(req.body.grade || 'Junior').trim();
    const avatar = String(req.body.avatar || '👤').trim();
    const registrationNote = String(req.body.registrationNote || '').trim();

    if (!name || name.length < 2) throw new Error('Вкажіть імʼя працівника');
    if (!role || role.length < 2) throw new Error('Вкажіть роль працівника');
    if (!ethers.utils.isAddress(wallet)) throw new Error('Некоректна MetaMask address');

    if (getAdminWallets().includes(wallet)) {
      throw new Error('Цей гаманець уже є адміністраторським. Використайте інший гаманець працівника.');
    }

    const duplicateWallet = await get(`SELECT * FROM employees WHERE lower(wallet) = lower(?) LIMIT 1`, [wallet]);
    if (duplicateWallet) {
      if (duplicateWallet.status === 'pending') throw new Error('Заявка з цим гаманцем уже очікує підтвердження адміністратора');
      throw new Error('Цей гаманець уже привʼязаний до працівника');
    }

    const maxRow = await get(`SELECT COALESCE(MAX(tokenId), -1) as maxTokenId FROM employees`);
    const nextTokenId = Number(maxRow.maxTokenId) + 1;

    await run(
      `INSERT INTO employees (tokenId, name, role, wallet, avatar, grade, status, registrationNote, registeredAt)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)`,
      [nextTokenId, name, role, wallet, avatar, grade, registrationNote]
    );

    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [nextTokenId]);
    res.status(201).json({
      status: 'success',
      message: 'Заявку створено. Вхід стане доступним після підтвердження адміністратором.',
      employee
    });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.get('/api/employees', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'user') {
      return res.json([req.user.employee]);
    }
    const rows = await all(`SELECT * FROM employees ORDER BY tokenId ASC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dev/seed-employees', requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`INSERT OR IGNORE INTO employees (tokenId, name, role, avatar, grade, status, approvedAt) VALUES
      (0, 'Ілля', 'Frontend Developer', '💻', 'Junior', 'active', CURRENT_TIMESTAMP),
      (1, 'Олександр', 'Backend Developer', '🛠️', 'Middle', 'active', CURRENT_TIMESTAMP),
      (2, 'Марія', 'QA Engineer', '🧪', 'Junior', 'active', CURRENT_TIMESTAMP)`);
    const rows = await all(`SELECT * FROM employees ORDER BY tokenId ASC`);
    res.json({ status: 'success', employees: rows });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/employees', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.body.tokenId);
    const name = String(req.body.name || '').trim();
    const role = String(req.body.role || '').trim();
    const wallet = String(req.body.wallet || '').trim();
    const avatar = String(req.body.avatar || '👤').trim();
    const grade = String(req.body.grade || 'Junior').trim();
    const status = String(req.body.status || 'active').trim();

    if (!Number.isInteger(tokenId) || tokenId < 0) throw new Error('Некоректний tokenId');
    if (!name || !role) throw new Error('Заповніть імʼя та роль');
    if (wallet && !ethers.utils.isAddress(wallet)) throw new Error('Некоректна адреса гаманця');

    const normalizedWallet = normalizeAddress(wallet);
    if (normalizedWallet) {
      const duplicate = await get(`SELECT * FROM employees WHERE lower(wallet) = lower(?) AND tokenId != ? LIMIT 1`, [normalizedWallet, tokenId]);
      if (duplicate) throw new Error('Цей гаманець уже привʼязаний до іншого працівника');
    }

    await run(
      `INSERT INTO employees (tokenId, name, role, wallet, avatar, grade, status, approvedAt) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [tokenId, name, role, normalizedWallet, avatar, grade, status, status]
    );
    await logAudit(req, 'employee_create', 'employee', tokenId, { name, role, wallet: normalizedWallet, grade, status });
    res.status(201).json({ status: 'success', tokenId });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.put('/api/employees/:id/wallet', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.params.id);
    const wallet = normalizeAddress(req.body.wallet);
    if (!Number.isInteger(tokenId) || tokenId < 0) throw new Error('Некоректний tokenId');
    if (!ethers.utils.isAddress(wallet)) throw new Error('Некоректна адреса гаманця');

    const duplicate = await get(`SELECT * FROM employees WHERE lower(wallet) = lower(?) AND tokenId != ? LIMIT 1`, [wallet, tokenId]);
    if (duplicate) throw new Error('Цей гаманець уже привʼязаний до іншого працівника');

    const result = await run(`UPDATE employees SET wallet = ? WHERE tokenId = ?`, [wallet, tokenId]);
    if (!result.changes) return res.status(404).json({ status: 'error', message: 'Працівника не знайдено' });
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [tokenId]);
    await logAudit(req, 'wallet_update', 'employee', tokenId, { wallet });
    res.json({ status: 'success', employee });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.get('/api/registrations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM employees WHERE status = 'pending' ORDER BY registeredAt ASC, createdAt ASC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/registrations/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.params.id);
    const result = await run(`UPDATE employees SET status = 'active', approvedAt = CURRENT_TIMESTAMP WHERE tokenId = ? AND status = 'pending'`, [tokenId]);
    if (!result.changes) return res.status(404).json({ status: 'error', message: 'Заявку не знайдено або вона вже оброблена' });
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [tokenId]);
    await logAudit(req, 'registration_approve', 'employee', tokenId, { wallet: employee.wallet, name: employee.name });
    res.json({ status: 'success', employee });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.post('/api/registrations/:id/block', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.params.id);
    const result = await run(`UPDATE employees SET status = 'blocked' WHERE tokenId = ?`, [tokenId]);
    if (!result.changes) return res.status(404).json({ status: 'error', message: 'Працівника не знайдено' });
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [tokenId]);
    await logAudit(req, 'registration_block', 'employee', tokenId, { wallet: employee.wallet, name: employee.name });
    res.json({ status: 'success', employee });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.post('/api/employees/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.params.id);
    const status = String(req.body.status || '').trim();
    if (!['active', 'pending', 'blocked'].includes(status)) throw new Error('Некоректний статус');
    const result = await run(`UPDATE employees SET status = ?, approvedAt = CASE WHEN ? = 'active' THEN COALESCE(approvedAt, CURRENT_TIMESTAMP) ELSE approvedAt END WHERE tokenId = ?`, [status, status, tokenId]);
    if (!result.changes) return res.status(404).json({ status: 'error', message: 'Працівника не знайдено' });
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [tokenId]);
    await logAudit(req, 'employee_status_update', 'employee', tokenId, { status });
    res.json({ status: 'success', employee });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.post('/webhook/task-completed', requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = validateTaskPayload(req.body);
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [payload.employeeTokenId]);
    if (!employee) return res.status(404).json({ status: 'error', message: 'Працівника не знайдено' });
    if (employee.status !== 'active') throw new Error('Нарахування доступне тільки для підтверджених активних працівників');

    const scoring = await calculateReputation(
      payload.employeeTokenId,
      payload.taskComplexity,
      payload.qualityScore,
      payload.missedDeadline
    );

    let transactionHash = null;
    let blockchainStatus = 'skipped';

    if (isBlockchainConfigured()) {
      const contract = getContract();
      const tx = await contract.updateReputation(
        payload.employeeTokenId,
        scoring.earnedPoints,
        scoring.reliabilityScore
      );
      transactionHash = tx.hash;
      blockchainStatus = 'pending';
      await tx.wait();
      blockchainStatus = 'confirmed';
    }

    const record = await run(
      `INSERT INTO performance_history
       (employeeId, taskTitle, taskCategory, earnedPoints, taskComplexity, qualityScore, missedDeadline, reliabilityScore, streakBonus, transactionHash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.employeeTokenId,
        payload.taskTitle,
        payload.taskCategory,
        scoring.earnedPoints,
        payload.taskComplexity,
        payload.qualityScore,
        payload.missedDeadline ? 1 : 0,
        scoring.reliabilityScore,
        scoring.streakBonus,
        transactionHash
      ]
    );

    const recommendations = await generateLearningRecommendations(payload, scoring, record.id);

    await logAudit(req, 'task_completed', 'employee', payload.employeeTokenId, {
      taskTitle: payload.taskTitle,
      earnedPoints: scoring.earnedPoints,
      reliabilityScore: scoring.reliabilityScore,
      transactionHash,
      recommendationsCreated: recommendations.length
    });

    res.json({
      status: 'success',
      recordId: record.id,
      employee,
      scoring,
      blockchainStatus,
      transactionHash,
      etherscanUrl: transactionHash ? `${process.env.ETHERSCAN_TX_URL || 'https://sepolia.etherscan.io/tx/'}${transactionHash}` : null,
      recommendations
    });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.get('/api/tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await all(`
      SELECT h.id, h.employeeId, e.name AS employeeName, e.role AS employeeRole,
        h.taskTitle, h.taskCategory, h.earnedPoints, h.taskComplexity,
        h.qualityScore, h.missedDeadline, h.reliabilityScore, h.streakBonus,
        h.transactionHash, h.createdAt
      FROM performance_history h
      LEFT JOIN employees e ON e.tokenId = h.employeeId
      ORDER BY h.createdAt DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/employee/:id/history', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.id);
    if (!canAccessEmployee(req, empId)) return res.status(403).json({ error: 'Немає доступу до профілю іншого працівника' });
    const rows = await all(
      `SELECT id, taskTitle, taskCategory, earnedPoints, taskComplexity, qualityScore, missedDeadline, reliabilityScore, streakBonus, transactionHash, createdAt
       FROM performance_history WHERE employeeId = ? ORDER BY createdAt ASC LIMIT 30`,
      [empId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/employee/:id/summary', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.id);
    if (!canAccessEmployee(req, empId)) return res.status(403).json({ error: 'Немає доступу до профілю іншого працівника' });
    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [empId]);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const stats = await get(`SELECT
      COALESCE(SUM(earnedPoints), 0) as localPoints,
      COUNT(*) as tasksCompleted,
      ROUND(AVG(qualityScore), 1) as avgQuality,
      COALESCE(SUM(missedDeadline), 0) as missedDeadlines,
      COALESCE((SELECT reliabilityScore FROM performance_history WHERE employeeId = ? ORDER BY createdAt DESC LIMIT 1), 100) as lastReliability
      FROM performance_history WHERE employeeId = ?`, [empId, empId]);

    const categories = await all(`SELECT taskCategory, COUNT(*) as total, SUM(earnedPoints) as points
      FROM performance_history WHERE employeeId = ? GROUP BY taskCategory ORDER BY points DESC`, [empId]);

    res.json({ employee, stats, categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const rows = await all(`SELECT e.tokenId, e.name, e.role, e.avatar, e.grade, e.status,
      COALESCE(SUM(h.earnedPoints), 0) as points,
      COUNT(h.id) as tasks,
      COALESCE(ROUND(AVG(h.qualityScore), 1), 0) as avgQuality,
      COALESCE((SELECT reliabilityScore FROM performance_history WHERE employeeId = e.tokenId ORDER BY createdAt DESC LIMIT 1), 100) as reliability
      FROM employees e
      LEFT JOIN performance_history h ON h.employeeId = e.tokenId
      WHERE e.status = 'active'
      GROUP BY e.tokenId
      ORDER BY points DESC, reliability DESC, avgQuality DESC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/employee/:id/recommendations', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.id);
    if (!canAccessEmployee(req, empId)) return res.status(403).json({ error: 'Немає доступу до рекомендацій іншого працівника' });

    const rows = await all(`
      SELECT er.id, er.employeeId, er.taskId, er.type, er.reason, er.priority, er.skillGap, er.expectedOutcome,
        er.status, er.createdAt, er.updatedAt,
        lr.title, lr.provider, lr.url, lr.category, lr.skillTag, lr.level, lr.reason AS resourceReason,
        lr.triggerType, lr.incentiveType,
        h.taskTitle, h.taskCategory, h.qualityScore, h.missedDeadline
      FROM employee_recommendations er
      JOIN learning_resources lr ON lr.id = er.resourceId
      LEFT JOIN performance_history h ON h.id = er.taskId
      WHERE er.employeeId = ?
      ORDER BY CASE er.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
        er.createdAt DESC
      LIMIT 20`,
      [empId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recommendations/:id/status', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || '').trim();
    if (!['new', 'in_progress', 'completed', 'dismissed'].includes(status)) throw new Error('Некоректний статус рекомендації');

    const rec = await get(`SELECT * FROM employee_recommendations WHERE id = ?`, [id]);
    if (!rec) return res.status(404).json({ status: 'error', message: 'Рекомендацію не знайдено' });
    if (!canAccessEmployee(req, rec.employeeId)) return res.status(403).json({ status: 'error', message: 'Немає доступу до рекомендації іншого працівника' });

    await run(`UPDATE employee_recommendations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [status, id]);
    const updated = await getRecommendationById(id);
    res.json({ status: 'success', recommendation: updated });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
});

app.get('/api/learning-resources', requireAuth, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM learning_resources ORDER BY category, skillTag, id`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/employee/:id/nudge', requireAuth, async (req, res) => {
  try {
    const empId = Number(req.params.id);
    if (!canAccessEmployee(req, empId)) return res.status(403).json({ type: 'error', message: 'Немає доступу до профілю іншого працівника' });

    const activeRec = await get(`
      SELECT er.*, lr.title, lr.provider, lr.url
      FROM employee_recommendations er
      JOIN learning_resources lr ON lr.id = er.resourceId
      WHERE er.employeeId = ? AND er.status IN ('new', 'in_progress')
      ORDER BY er.createdAt DESC
      LIMIT 1`, [empId]);

    if (activeRec) {
      return res.json({
        type: activeRec.type || 'info',
        title: 'Індивідуальна рекомендація розвитку',
        message: `${activeRec.reason} Конкретний ресурс для розвитку: ${activeRec.provider} — ${activeRec.title}. Очікуваний результат: ${activeRec.expectedOutcome || 'покращення навичок у проблемному напрямі'}.`,
        url: activeRec.url,
        resourceTitle: activeRec.title,
        resourceProvider: activeRec.provider
      });
    }

    const history = await all(
      `SELECT * FROM performance_history WHERE employeeId = ? ORDER BY createdAt DESC LIMIT 3`,
      [empId]
    );

    if (history.length === 0) {
      return res.json({ type: 'info', title: 'Новий профіль', message: 'Поки немає достатньо даних. Закрийте перші задачі, щоб система сформувала рекомендації.' });
    }

    const last = history[0];
    if (last.missedDeadline) {
      return res.json({ type: 'warning', title: 'Ризик по дедлайнах', message: 'Останній дедлайн був зірваний. Система автоматично підбере навчальний ресурс після наступного збереження задачі.' });
    }
    if (last.qualityScore < 70) {
      return res.json({ type: 'warning', title: 'Якість потребує уваги', message: 'Остання задача має невисоку оцінку якості. Рекомендації з code review будуть додані до траєкторії розвитку.' });
    }
    if (history.length >= 3 && history.every(t => !t.missedDeadline && t.qualityScore >= 80)) {
      return res.json({ type: 'success', title: 'Стабільна продуктивність', message: 'Працівник демонструє стабільне виконання задач. Можна підвищити складність задач або надати бонус.' });
    }
    res.json({ type: 'success', title: 'Позитивна динаміка', message: 'Задача виконана успішно. Продовжуйте підтримувати якість і дедлайни.' });
  } catch (error) {
    res.status(500).json({ type: 'error', message: error.message });
  }
});

app.post("/api/employees/:tokenId/sync-metadata", requireAdmin, async (req, res) => {
  try {
    const tokenId = Number(req.params.tokenId);

    const employee = await get(
      `SELECT * FROM employees WHERE tokenId = ?`,
      [tokenId]
    );

    if (!employee) {
      return res.status(404).json({
        status: "error",
        message: "Працівника не знайдено"
      });
    }

    const githubResult = await updatePassportMetadataOnGitHub(employee);

    res.json({
      status: "success",
      message: "Metadata Web3-паспорта оновлено на GitHub",
      employee,
      github: githubResult
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      message: error.message
    });
  }
});
app.get('/api/analytics/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totals = await get(`
      SELECT
        (SELECT COUNT(*) FROM employees) AS totalEmployees,
        (SELECT COUNT(*) FROM employees WHERE status = 'active') AS activeEmployees,
        (SELECT COUNT(*) FROM employees WHERE status = 'pending') AS pendingEmployees,
        (SELECT COUNT(*) FROM employees WHERE status = 'blocked') AS blockedEmployees,
        (SELECT COUNT(*) FROM performance_history) AS totalTasks,
        COALESCE((SELECT SUM(earnedPoints) FROM performance_history), 0) AS totalPoints,
        COALESCE((SELECT ROUND(AVG(qualityScore), 1) FROM performance_history), 0) AS avgQuality,
        COALESCE((SELECT ROUND(AVG(reliabilityScore), 1) FROM performance_history), 100) AS avgReliability,
        COALESCE((SELECT SUM(missedDeadline) FROM performance_history), 0) AS missedDeadlines,
        (SELECT COUNT(*) FROM employee_recommendations WHERE status = 'new') AS newRecommendations,
        (SELECT COUNT(*) FROM employee_recommendations WHERE status = 'in_progress') AS inProgressRecommendations,
        (SELECT COUNT(*) FROM employee_recommendations WHERE status = 'completed') AS completedRecommendations
    `);

    const topEmployees = await all(`
      SELECT e.tokenId, e.name, e.role, e.avatar, e.grade,
        COALESCE(SUM(h.earnedPoints), 0) AS points,
        COUNT(h.id) AS tasks,
        COALESCE(ROUND(AVG(h.qualityScore), 1), 0) AS avgQuality,
        COALESCE((SELECT reliabilityScore FROM performance_history WHERE employeeId = e.tokenId ORDER BY createdAt DESC LIMIT 1), 100) AS reliability
      FROM employees e
      LEFT JOIN performance_history h ON h.employeeId = e.tokenId
      WHERE e.status = 'active'
      GROUP BY e.tokenId
      ORDER BY points DESC, reliability DESC, avgQuality DESC
      LIMIT 10
    `);

    const categoryStats = await all(`
      SELECT taskCategory,
        COUNT(*) AS totalTasks,
        COALESCE(SUM(earnedPoints), 0) AS points,
        COALESCE(ROUND(AVG(qualityScore), 1), 0) AS avgQuality,
        COALESCE(SUM(missedDeadline), 0) AS missedDeadlines
      FROM performance_history
      GROUP BY taskCategory
      ORDER BY totalTasks DESC
    `);

    const riskyEmployees = await all(`
      SELECT e.tokenId, e.name, e.role, e.avatar, e.grade,
        COUNT(h.id) AS tasks,
        COALESCE(SUM(h.missedDeadline), 0) AS missedDeadlines,
        COALESCE(ROUND(AVG(h.qualityScore), 1), 0) AS avgQuality,
        COALESCE((SELECT reliabilityScore FROM performance_history WHERE employeeId = e.tokenId ORDER BY createdAt DESC LIMIT 1), 100) AS reliability
      FROM employees e
      LEFT JOIN performance_history h ON h.employeeId = e.tokenId
      WHERE e.status = 'active'
      GROUP BY e.tokenId
      HAVING missedDeadlines > 0 OR avgQuality < 75 OR reliability < 80
      ORDER BY missedDeadlines DESC, reliability ASC, avgQuality ASC
      LIMIT 10
    `);

    const recommendationStats = await all(`
      SELECT er.status, COUNT(*) AS total
      FROM employee_recommendations er
      GROUP BY er.status
      ORDER BY total DESC
    `);

    const trend = await all(`
      SELECT DATE(createdAt) AS date,
        COUNT(*) AS tasks,
        COALESCE(SUM(earnedPoints), 0) AS points,
        COALESCE(ROUND(AVG(qualityScore), 1), 0) AS avgQuality,
        COALESCE(ROUND(AVG(reliabilityScore), 1), 0) AS avgReliability
      FROM performance_history
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
      LIMIT 30
    `);

    res.json({
      status: 'success',
      totals,
      topEmployees,
      categoryStats,
      riskyEmployees,
      recommendationStats,
      trend
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});
app.get('/api/passport/:id', requireAuth, async (req, res) => {
  try {
    const tokenId = Number(req.params.id);

    if (!Number.isInteger(tokenId) || tokenId < 0) {
      throw new Error('Некоректний tokenId');
    }

    if (!canAccessEmployee(req, tokenId)) {
      return res.status(403).json({
        status: 'error',
        message: 'Немає доступу до Web3-паспорта іншого працівника'
      });
    }

    const employee = await get(`SELECT * FROM employees WHERE tokenId = ?`, [tokenId]);

    if (!employee) {
      return res.status(404).json({
        status: 'error',
        message: 'Працівника не знайдено'
      });
    }

    if (!isBlockchainConfigured()) {
      return res.json({
        status: 'partial',
        message: 'Blockchain не налаштований у .env',
        employee,
        blockchain: null,
        metadata: null
      });
    }

    const contract = getReadOnlyPassportContract();

    const exists = await contract.passportExists(tokenId);

    if (!exists) {
      return res.json({
        status: 'not_minted',
        message: 'Web3-паспорт ще не створено у смарт-контракті',
        employee,
        blockchain: {
          contractAddress: process.env.CONTRACT_ADDRESS,
          tokenId,
          exists: false
        },
        metadata: null
      });
    }

    const owner = await contract.ownerOf(tokenId);
    const uri = await contract.tokenURI(tokenId);
    const rep = await contract.employeeReputation(tokenId);

    let metadata = null;
    let metadataError = null;

    try {
      const metadataResponse = await fetch(uri);

      if (!metadataResponse.ok) {
        throw new Error(`Metadata HTTP ${metadataResponse.status}`);
      }

      metadata = await metadataResponse.json();
    } catch (error) {
      metadataError = error.message;
    }

    const explorerBase = 'https://sepolia.etherscan.io';

    res.json({
      status: 'success',
      employee,
      blockchain: {
        contractAddress: process.env.CONTRACT_ADDRESS,
        contractUrl: `${explorerBase}/address/${process.env.CONTRACT_ADDRESS}`,
        tokenId,
        exists: true,
        owner,
        tokenURI: uri,
        ownerMatchesDbWallet: normalizeAddress(owner) === normalizeAddress(employee.wallet),
        reputation: {
          totalPoints: rep.totalPoints.toString(),
          tasksCompleted: rep.tasksCompleted.toString(),
          reliabilityScore: rep.reliabilityScore.toString(),
          currentStreak: rep.currentStreak.toString(),
          lastUpdatedAt: Number(rep.lastUpdatedAt.toString())
        }
      },
      metadata,
      metadataError
    });
  } catch (error) {
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
});
initDb()
  .then(() => app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`)))
  .catch((error) => {
    console.error('DB init error:', error);
    process.exit(1);
  });