console.log("Mint script started");
require("dotenv").config();
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const METADATA_BASE_URL = (process.env.METADATA_BASE_URL || 'https://illyastydy.github.io/web3-passports-metadata/metadata').replace(/\/$/, '');

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  console.error("❌ Проверь .env: RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS должны быть заполнены");
  process.exit(1);
}

const abi = [
  "function mintPassport(address employee, string memory uri) public returns (uint256)",
  "function owner() view returns (address)",
  "function passportExists(uint256 tokenId) view returns (bool)"
];

const employees = [
  {
    name: "Ілля",
    wallet: "0xC08B5627BEfa02617B101289380a027373eAE0BE",
    uri: `${METADATA_BASE_URL}/0.json`
  },
  {
    name: "Олександр",
    wallet: "0x0E45bC588431382369041480e6E86790fA2813CF",
    uri: `${METADATA_BASE_URL}/1.json`
  },
  {
    name: "Марія",
    wallet: "0xdb908c2E7f64e9B254e093927A074EF2101C26e8",
    uri: `${METADATA_BASE_URL}/2.json`
  },
  {
    name: "Анна",
    wallet: "0x7BCDCAd61d3ec8BB98f33bD01D18470EdB25D050",
    uri: `${METADATA_BASE_URL}/3.json`
    },
  {
    name: "Дмитро",
    wallet: "0x48E8D4f101Fd2D6A4fc94A27bE0a9aFA31b19aB7",
    uri: `${METADATA_BASE_URL}/4.json`
  },
  {
    name: "Софія",
    wallet: "0x908fd55C87E6D43FC6f650ED47CE854cEe6C62d2",
    uri: `${METADATA_BASE_URL}/5.json`
  },
  {
    name: "Максим",
    wallet: "0x12946223085Ff59479A3Db2a97b8544e35495eA8",
    uri: `${METADATA_BASE_URL}/6.json`
  },
  {
    name: "Вікторія",
    wallet: "0x6B3b2619161EA6a03D76F4C68945af75Cd43b81c",
    uri: `${METADATA_BASE_URL}/7.json`
  },
  {
    name: "Артем",
    wallet: "0x2998c588Bc3FfF9330801A46c87CAb43D01F5f9f",
    uri: `${METADATA_BASE_URL}/8.json`
  },
  {
    name: "Катерина",
    wallet: "0x081985cffFa2F4B69DE55B4086D3ae8762F1040d",
    uri: `${METADATA_BASE_URL}/9.json`
  },
  {
    name: "Богдан",
    wallet: "0x15648d841b02cb726405acEbE0e42b8642a545Df",
    uri: `${METADATA_BASE_URL}/10.json`
  },
  {
    name: "Олена",
    wallet: "0xC62f392c0B1EC8D8A208A0d9FEaaBDD7047B27EC",
    uri: `${METADATA_BASE_URL}/11.json`
  },
  {
    name: "Назар",
    wallet: "0xf0E7aD0DCF7553A00078677814A6Ac6F70137B71",
    uri: `${METADATA_BASE_URL}/12.json`
  },
  {
    name: "Сергій",
    wallet: "0x22E25Ec6d294dAeb58af7D6d9599bfd33bB934dF",
    uri: `${METADATA_BASE_URL}/13.json`
  }
];

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

  console.log("Запуск від імені:", wallet.address);
  console.log("Контракт:", CONTRACT_ADDRESS);
  console.log("Metadata base URL:", METADATA_BASE_URL);

  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i];

    if (!ethers.utils.isAddress(employee.wallet)) {
      console.log(`❌ ${employee.name}: неправильний wallet address`);
      continue;
    }

    try {
      const exists = await contract.passportExists(i);

      if (exists) {
        console.log(`⚠️ tokenId ${i} для ${employee.name} вже існує, пропускаю`);
        continue;
      }

      console.log(`⏳ Створюю паспорт для ${employee.name}...`);

      const tx = await contract.mintPassport(employee.wallet, employee.uri);
      console.log(`TX відправлено: ${tx.hash}`);

      await tx.wait();

      console.log(`✅ Паспорт створено для ${employee.name}, tokenId: ${i}`);
    } catch (error) {
      console.error(`❌ Помилка для ${employee.name}:`, error.reason || error.message);
    }
  }

  console.log("Готово!");
}

main();