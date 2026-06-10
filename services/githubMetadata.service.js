const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_METADATA_BASE_URL = process.env.GITHUB_METADATA_BASE_URL;

/**
 * Робить запит до GitHub API.
 */
async function githubRequest(url, options = {}) {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN не налаштований у .env");
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `GitHub API error: ${res.status}`);
  }

  return data;
}

/**
 * Генерує JSON metadata для Web3-паспорта.
 */
function buildPassportMetadata(employee) {
  const tokenId = Number(employee.tokenId);

  return {
    name: `Web3 Professional Passport #${tokenId} — ${employee.name}`,
    description:
      "Soulbound reputation passport for employee productivity tracking in a Web3-based information system.",
    image: `${GITHUB_METADATA_BASE_URL}/images/passport-${tokenId}.png`,
    animation_url: `${GITHUB_METADATA_BASE_URL}/images/passport-${tokenId}.svg`,
    attributes: [
      {
        trait_type: "Employee",
        value: employee.name || "Unknown"
      },
      {
        trait_type: "Role",
        value: employee.role || "Employee"
      },
      {
        trait_type: "Grade",
        value: employee.grade || "Junior"
      },
      {
        trait_type: "Status",
        value: employee.status || "active"
      },
      {
        trait_type: "Passport Type",
        value: "Soulbound Token"
      },
      {
        trait_type: "Transferability",
        value: "Non-transferable"
      }
    ]
  };
}

/**
 * Створює або оновлює файл metadata/{tokenId}.json у GitHub.
 */
async function updatePassportMetadataOnGitHub(employee) {
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_METADATA_BASE_URL) {
    throw new Error("GitHub metadata settings не повністю налаштовані у .env");
  }

  const tokenId = Number(employee.tokenId);
  const filePath = `metadata/${tokenId}.json`;

  const metadata = buildPassportMetadata(employee);

  const contentBase64 = Buffer
    .from(JSON.stringify(metadata, null, 2), "utf8")
    .toString("base64");

  const fileUrl =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

  let sha = null;

  try {
    const currentFile = await githubRequest(`${fileUrl}?ref=${GITHUB_BRANCH}`);
    sha = currentFile.sha;
  } catch (error) {
    if (!String(error.message).includes("Not Found")) {
      throw error;
    }
  }

  const body = {
    message: `Update metadata for passport #${tokenId}`,
    content: contentBase64,
    branch: GITHUB_BRANCH
  };

  if (sha) {
    body.sha = sha;
  }

  const result = await githubRequest(fileUrl, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  return {
    status: "success",
    tokenId,
    path: filePath,
    metadataUrl: `${GITHUB_METADATA_BASE_URL}/metadata/${tokenId}.json`,
    imageUrl: `${GITHUB_METADATA_BASE_URL}/images/passport-${tokenId}.png`,
    commitUrl: result.commit?.html_url || null
  };
}

module.exports = {
  buildPassportMetadata,
  updatePassportMetadataOnGitHub
};