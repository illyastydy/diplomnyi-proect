# Web3 Productivity Reputation System — Diploma Version

Дипломний проєкт: **інформаційна система стимулювання продуктивності працівників на основі репутаційних Web3-профілів**.

Система поєднує backend-модуль, локальну базу даних, вебінтерфейс адміністратора та працівника, авторизацію через MetaMask, смарт-контракт Web3-паспорта, NFT metadata, аналітику продуктивності та індивідуальні рекомендації розвитку.

---

## Основна ідея проєкту

Мета системи — формування цифрового репутаційного профілю працівника на основі результатів виконання задач, якості роботи, дотримання дедлайнів і професійного розвитку.

Працівник отримує непередаваний Web3-паспорт у форматі Soulbound NFT. До цього паспорта прив’язується публічна MetaMask-адреса працівника, tokenId, metadata, репутаційні показники, історія задач та індивідуальна траєкторія розвитку.

Система дозволяє:

- оцінювати виконання задач;
- враховувати якість роботи;
- фіксувати зриви дедлайнів;
- нараховувати репутаційні бали;
- формувати рекомендації з навчальними матеріалами;
- переглядати Web3-паспорт працівника;
- аналізувати продуктивність команди через адміністративну аналітику.

---

## Основні можливості

### Авторизація та ролі

- Вхід через MetaMask.
- Авторизація без паролів за допомогою криптографічного підпису.
- Ролі користувачів:
  - адміністратор;
  - працівник.
- Адміністратор має доступ до панелі керування, аналітики, заявок і Web3-паспортів.
- Працівник має доступ до власного профілю, задач, рекомендацій і Web3-паспорта.

---

### Реєстрація працівників

У системі реалізовано сторінку реєстрації:

```txt
/register.html
```

Працівник може подати заявку, вказавши:

- ім’я;
- роль;
- грейд;
- коментар;
- MetaMask public address.

Після створення заявки працівник отримує статус:

```txt
pending
```

Поки адміністратор не підтвердить заявку, працівник не може повноцінно використовувати систему.

Адміністратор у панелі керування може:

- переглядати заявки;
- підтверджувати заявку;
- відхиляти заявку;
- активувати працівника;
- блокувати працівника.

Підтримуються статуси:

```txt
pending
active
blocked
```

Підтримуються грейди:

```txt
Intern
Junior
Middle
Senior
Team Lead
```

---

### Web3-паспорти працівників

Для кожного працівника створюється Web3-паспорт у форматі Soulbound NFT.

Реалізовано:

- Solidity smart contract;
- mint Web3-паспортів;
- tokenId для кожного працівника;
- прив’язку tokenId до wallet address;
- metadata JSON;
- SVG та PNG зображення паспортів;
- відображення паспорта в MetaMask;
- сторінку перегляду Web3-паспорта в системі.

Сторінка Web3-паспорта:

```txt
/passport.html
```

На ній відображається:

- працівник з бази даних;
- tokenId;
- wallet у БД;
- owner wallet зі смарт-контракту;
- tokenURI;
- metadata JSON;
- зображення паспорта;
- on-chain reputation;
- посилання на Sepolia Etherscan.

---

### Metadata NFT

У проєкті є локальні metadata-файли:

```txt
public/metadata/*.json
```

І зображення Web3-паспортів:

```txt
public/images/passport-*.svg
public/images/passport-*.png
```

Для локального тестування metadata доступна за адресами:

```txt
http://localhost:3000/metadata/0.json
http://localhost:3000/images/passport-0.png
http://localhost:3000/images/passport-0.svg
```
---

### GitHub metadata sync

У системі реалізовано сервіс для автоматичного оновлення metadata Web3-паспорта через GitHub API.

Файл сервісу:

```txt
services/githubMetadata.service.js
```

Механізм дозволяє:

- згенерувати актуальний metadata JSON;
- оновити `metadata/{tokenId}.json` у GitHub repository;
- створити commit через GitHub API;
- оновити роль, грейд, статус або інші атрибути Web3-паспорта.


### Система стимулювання продуктивності

Після виконання задачі система аналізує:

- якість виконання;
- наявність або відсутність зриву дедлайну;
- reliability score;
- категорію задачі;
- складність задачі;
- кількість отриманих балів.

Якщо виявлено проблему, система створює **індивідуальну рекомендацію розвитку** з посиланням на навчальний матеріал або курс.

Приклади логіки:

```txt
missed deadline → рекомендація з планування, Agile або Jira
low quality score → рекомендація з code review або testing
Frontend problem → React / JavaScript / performance materials
Backend problem → Node.js / API materials
Security problem → OWASP materials
Blockchain problem → smart contract security materials
```

Якщо працівник виконує задачу якісно та без зриву дедлайну, система може запропонувати матеріали для професійного росту.

---

### Індивідуальна траєкторія розвитку

У профілі працівника реалізовано блок:

```txt
Індивідуальна траєкторія розвитку
```

У ньому відображаються:

- причина рекомендації;
- навичка, яку потрібно покращити;
- навчальний ресурс;
- посилання на курс або матеріал;
- статус рекомендації.

Підтримуються статуси рекомендацій:

```txt
new
in_progress
completed
dismissed
```

Працівник може позначати рекомендацію як:

- розпочату;
- пройдену;
- неактуальну.

---

### Аналітика адміністратора

У системі є окрема сторінка аналітики:

```txt
/analytics.html
```

На ній відображається:

- загальна кількість працівників;
- кількість активних працівників;
- кількість виконаних задач;
- загальна кількість репутаційних балів;
- середня якість виконання задач;
- середній reliability score;
- топ працівників;
- працівники з ризиками;
- статистика рекомендацій;
- графіки продуктивності;
- графіки задач за категоріями.


---

### Audit logs

У системі реалізовано журнал дій адміністратора.

Таблиця:

```txt
audit_logs
```

У ній фіксуються важливі події:

- підтвердження заявки;
- відхилення заявки;
- зміна статусу працівника;
- прив’язка wallet address;
- оновлення metadata;
- інші адміністративні дії.

Це підвищує прозорість роботи системи та дозволяє відстежувати зміни.

---

## Основні сторінки

```txt
/login.html       — вхід через MetaMask
/register.html    — заявка на реєстрацію працівника
/admin.html       — панель адміністратора
/profile.html     — профіль працівника
/passport.html    — Web3-паспорт працівника
/analytics.html   — аналітика продуктивності
```

---

## Технології

### Backend

- Node.js
- Express.js
- SQLite
- ethers.js
- dotenv
- cookie/session authentication

### Frontend

- HTML
- CSS
- JavaScript
- Chart.js
- MetaMask provider API

### Web3

- Solidity
- ERC-721 compatible Soulbound NFT
- Sepolia testnet
- MetaMask
- GitHub Pages metadata hosting
- Etherscan transaction tracking

### Storage

- SQLite database for application data;
- GitHub Pages for public NFT metadata;
- local `public/metadata` and `public/images` for development testing.

---

## Структура проєкту

```txt
.
├── contracts/                  # Solidity smart contracts
├── public/                     # Frontend pages, styles, metadata, images
│   ├── login.html
│   ├── register.html
│   ├── admin.html
│   ├── profile.html
│   ├── passport.html
│   ├── analytics.html
│   ├── metadata/
│   └── images/
├── scripts/                    # Scripts for minting and metadata preparation
│   └── mintPassports.js
├── services/                   # Backend services
│   └── githubMetadata.service.js
├── server.js                   # Main Express backend
├── package.json
├── package-lock.json
├── productivity.db             # SQLite demo database
├── .env.example
└── README.md
```

---

## Запуск проєкту

Встановити залежності:

```bash
npm install
```

Запустити сервер:

```bash
npm start
```

Відкрити у браузері:

```txt
http://localhost:3000
```

---

## Mint Web3-паспортів

Перед мінтом потрібно перевірити:

1. У `.env` вказано правильний `RPC_URL`.
2. У `.env` вказано `PRIVATE_KEY` owner/backend-manager гаманця.
3. У `.env` вказано правильний `CONTRACT_ADDRESS`.
4. Metadata доступна через публічний URL.
5. У `scripts/mintPassports.js` вказані правильні wallet-адреси працівників.

Запуск:

```bash
node scripts/mintPassports.js
```

Після успішного виконання скрипт створює Web3-паспорти для працівників і записує в токени URI виду:

```txt
https://your_github_username.github.io/web3-passports-metadata/metadata/0.json
```

---

## Робота зі смарт-контрактом

Смарт-контракт реалізує:

- створення Web3-паспорта;
- заборону передачі токена іншому власнику;
- збереження reputation state;
- оновлення репутаційних показників;
- перевірку власника passport token;
- підтримку manager/owner ролей.

Основні функції контракту:

```solidity
mintPassport(address employee, string memory uri)
updateReputation(uint256 tokenId, uint256 addedPoints, uint256 newReliabilityScore)
getReputation(uint256 tokenId)
ownerOf(uint256 tokenId)
tokenURI(uint256 tokenId)
```

---

## Перевірка NFT у MetaMask

Для імпорту NFT у MetaMask потрібно:

1. Вибрати мережу Sepolia.
2. Відкрити вкладку NFT.
3. Натиснути Import NFT.
4. Вказати адресу контракту.
5. Вказати tokenId працівника.

Приклад:

```txt
Contract address: 0xYourContractAddress
Token ID: 0
```

Якщо metadata та image URL налаштовані правильно, MetaMask підтягне:

- назву паспорта;
- опис;
- PNG-зображення;
- атрибути працівника.

---

## База даних

У проєкті використовується SQLite.

Основні таблиці:

```txt
employees
performance_history
learning_resources
employee_recommendations
audit_logs
auth_nonces
```

Таблиця `employees` зберігає:

- tokenId;
- ім’я;
- роль;
- грейд;
- статус;
- wallet address;
- avatar;
- дату створення.

Таблиця `performance_history` зберігає:

- задачі;
- категорії задач;
- складність;
- quality score;
- deadline status;
- earned points;
- reliability score.

Таблиця `employee_recommendations` зберігає індивідуальні рекомендації розвитку.

---

## Демонстраційний сценарій

1. Адміністратор входить через MetaMask.
2. Новий працівник подає заявку через `register.html`.
3. Адміністратор підтверджує заявку.
4. Працівнику створюється Web3-паспорт.
5. Адміністратор додає виконані задачі.
6. Система нараховує репутаційні бали.
7. Якщо є проблеми з якістю або дедлайнами, система створює рекомендації розвитку.
8. Працівник відкриває профіль і переглядає траєкторію розвитку.
9. Адміністратор відкриває аналітику.
10. На сторінці Web3-паспорта перевіряються tokenURI, metadata, owner wallet і reputation.

---

## Репозиторій metadata

Для відображення NFT у MetaMask використовується окремий репозиторій GitHub Pages:

```txt
web3-passports-metadata
```

Очікувана структура:

```txt
metadata/
  0.json
  1.json
  ...
images/
  passport-0.png
  passport-0.svg
  passport-1.png
  passport-1.svg
  ...
```

У `metadata/*.json` основне поле `image` має вести на PNG:

```json
"image": "https://your_github_username.github.io/web3-passports-metadata/images/passport-0.png"
```

---

## Призначення проєкту

Проєкт розроблено як дипломну інформаційну систему для демонстрації поєднання:

- класичної інформаційної системи;
- Web3-авторизації;
- Soulbound NFT;
- репутаційної моделі;
- рекомендаційної системи;
- аналітики продуктивності;
- публічної metadata-інфраструктури.

Розробка демонструє, як Web3-профіль може використовуватися не як фінансовий актив, а як цифровий професійний паспорт працівника.
